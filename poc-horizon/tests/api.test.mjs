import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../src/server.mjs';
import { categoriesOf, CATEGORIES, LABEL_MAP } from '../src/categories.mjs';

let server, url;
before(async () => {
  server = createServer(createHandler({
    ready: async () => true,
    infer: async text => {
      if (text === 'THROW') throw Error('SENTINELSECRET');
      if (text.includes('NATIVE')) return [{ entity_group: 'DRIVER_LICENSE', score: 0.9,
        word: 'SENTINELSECRET' }];
      return text.includes('mario.rossi@example.com')
        ? [{ entity_group: 'EMAIL', score: 0.9, word: 'mario.rossi@example.com' }]
        : text.includes('Mario Rossi')
          ? [{ entity_group: 'PERSON', score: 0.9, word: 'Mario Rossi' }]
          : [];
    },
  }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise(resolve => server.close(resolve)));
const field = (text, fieldId = 'description', allowedEntityTypes = []) =>
  ({ text, fieldId, allowedEntityTypes });
const post = (body, headers = { 'Content-Type': 'application/json' }) =>
  fetch(url + '/v1/analyze', { method: 'POST', headers, body: typeof body === 'string' ? body : JSON.stringify(body) });

test('readiness and neutral response contract', async () => {
  const ready = await fetch(url + '/health/ready');
  assert.deepEqual(await ready.json(), { status: 'ready' });
  const result = await post({ fields: [field('Servizio digitale.')] });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { verdict: 'accepted',
    modelPolicyVersion: 'horizon-pii-redactor-base-q8-ef0eff8e-poc2', findings: [] });
});
test('recognizes a synthetic fiscal-code-shaped value through the HTTP API', async () => {
  const response = await post({ fields: [field('ZZZQQQ99A01X000Z')] });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body).findings,
    [{ fieldId: 'description', entityType: 'IT_FISCAL_CODE' }]);
  assert.ok(!body.includes('ZZZQQQ'));
});
test('recognizes multiple occurrences once and accepts an allowlisted fiscal code', async () => {
  const text = 'Codice fiscale: ZZZQQQ99A01X000Z; zzzqqq99a01x000a.';
  const rejected = await post({ fields: [field(text)] });
  assert.deepEqual((await rejected.json()).findings,
    [{ fieldId: 'description', entityType: 'IT_FISCAL_CODE' }]);
  const allowed = await post({ fields: [field(text, 'description', ['IT_FISCAL_CODE'])] });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { verdict: 'accepted',
    modelPolicyVersion: 'horizon-pii-redactor-base-q8-ef0eff8e-poc2', findings: [] });
});
test('allowlisting the fiscal code retains an independently emitted native category', async () => {
  const response = await post({ fields: [field('NATIVE ZZZQQQ99A01X000Z',
    'description', ['IT_FISCAL_CODE'])] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).findings,
    [{ fieldId: 'description', entityType: 'DRIVER_LICENSE' }]);
});
test('a later inference failure returns no partial fiscal-code finding', async () => {
  const response = await post({ fields: [field('ZZZQQQ99A01X000Z'), field('THROW', 'contactName')] });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { code: 'ANALYZER_UNAVAILABLE' });
  assert.ok(!body.includes('ZZZQQQ'));
  assert.ok(!body.includes('IT_FISCAL_CODE'));
});
test('rejects email without text; allowlist applies after recognition', async () => {
  const response = await post({ fields: [field('mario.rossi@example.com')] });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body).findings,
    [{ fieldId: 'description', entityType: 'EMAIL_ADDRESS' }]);
  assert.ok(!body.includes('mario.rossi'));
  const allowed = await post({ fields: [field('Mario Rossi', 'description', ['PERSON'])] });
  assert.equal((await allowed.json()).verdict, 'accepted');
});
test('duplicate keys, fields, category, unknown ID, oversized body are 400', async () => {
  for (const body of [
    '{"fields":[],"fields":[{"fieldId":"description","text":"SENTINELSECRET","allowedEntityTypes":[] }]}',
    '{"fields":[{"fieldId":"description","fieldId":"description","text":"SENTINELSECRET","allowedEntityTypes":[]}]}',
    '{"fields":[],"\\u0066ields":[{"fieldId":"description","text":"SENTINELSECRET","allowedEntityTypes":[]}]}',
    { fields: [field('SENTINELSECRET'), field('SENTINELSECRET')] },
    { fields: [field('SENTINELSECRET','description',['PERSON','PERSON'])] },
    { fields: [field('SENTINELSECRET','SENTINELSECRET')] },
    { fields: [field('SENTINELSECRET','description',['UNKNOWN_CATEGORY'])] },
    { fields: [field('SENTINELSECRET'.repeat(3000))] },
    ' '.repeat(33000),
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.equal(text, '{"code":"INVALID_ANALYZE_REQUEST"}');
    assert.ok(!text.includes('SENTINELSECRET'));
  }
});
test('invalid UTF-8 fails before inference without echo', async () => {
  const response = await fetch(url + '/v1/analyze', { method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:Buffer.concat([Buffer.from('{"fields":[{"fieldId":"description","text":"'),
      Buffer.from([0xff]), Buffer.from('","allowedEntityTypes":[]}]}')]),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'INVALID_ANALYZE_REQUEST' });
});

test('second-field error is fail-closed without a partial verdict', async () => {
  const response = await post({ fields: [field('Servizio digitale.'), field('THROW','contactName')] });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'ANALYZER_UNAVAILABLE' });
});
test('findings sorted and deduplicated, no raw words', async () => {
  const response = await post({ fields: [field('Mario Rossi mario.rossi@example.com','contactName'),
    field('mario.rossi@example.com','description')] });
  assert.equal(response.status, 200);
  const text = await response.text();
  assert.ok(!text.includes('mario.rossi'));
  assert.deepEqual(JSON.parse(text).findings.map(f => f.fieldId), ['contactName','description']);
});
test('full label mapping and threshold, no false equivalence', () => {
  assert.equal(Object.keys(LABEL_MAP).length, 29);
  assert.ok(CATEGORIES.has('TAX_ID'));
  assert.ok(CATEGORIES.has('IT_FISCAL_CODE'));
  assert.deepEqual([...categoriesOf([{entity_group:'TAX_ID',score:0.9},
    {entity_group:'PERSON',score:0.2}])], ['TAX_ID']);
  assert.throws(() => categoriesOf([{entity_group:'UNKNOWN',score:0.8}]));
});
