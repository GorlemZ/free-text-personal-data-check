import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../src/server.mjs';
import { categoriesOf, CATEGORIES, LABEL_MAP } from '../src/categories.mjs';
import { vatCandidates } from '../dist/recognizers/vat.mjs';
import { italianIbanCandidates } from '../dist/recognizers/italian-iban.mjs';

let server, url;
before(async () => {
  server = createServer(createHandler({
    ready: async () => true,
    prepare: text => ({ text }),
    infer: async ({ text }) => {
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

test('the mocked HTTP handler uses an injected preflight', async () => {
  const handler = createHandler({ ready: async () => true, prepare: text => ({ text }),
    infer: async () => [] });
  const local = createServer(handler);
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const result = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field('A')] }),
    });
    assert.equal(result.status, 200);
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('readiness and neutral response contract', async () => {
  const ready = await fetch(url + '/health/ready');
  assert.deepEqual(await ready.json(), { status: 'ready' });
  const result = await post({ fields: [field('Servizio digitale.')] });
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { verdict: 'accepted',
    modelPolicyVersion: 'horizon-pii-redactor-base-q8-ef0eff8e-poc4-seven-it-checksum-union', findings: [] });
});
test('recognizes a synthetic fiscal-code-shaped value through the HTTP API', async () => {
  const response = await post({ fields: [field('RSSMRA85M01H501Q')] });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body).findings,
    [{ fieldId: 'description', entityType: 'IT_FISCAL_CODE' }]);
  assert.ok(!body.includes('RSSMRA'));
});
test('recognizes multiple occurrences once and accepts an allowlisted fiscal code', async () => {
  const text = 'Codice fiscale: RSSMRA85M01H501Q; rssmra85m01h501q.';
  const rejected = await post({ fields: [field(text)] });
  assert.deepEqual((await rejected.json()).findings,
    [{ fieldId: 'description', entityType: 'IT_FISCAL_CODE' }]);
  const allowed = await post({ fields: [field(text, 'description', ['IT_FISCAL_CODE'])] });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { verdict: 'accepted',
    modelPolicyVersion: 'horizon-pii-redactor-base-q8-ef0eff8e-poc4-seven-it-checksum-union', findings: [] });
});
test('allowlisted fiscal code ignores a known native category outside the catalog', async () => {
  const response = await post({ fields: [field('NATIVE RSSMRA85M01H501Q',
    'description', ['IT_FISCAL_CODE'])] });
  assert.equal(response.status, 200);
  assert.deepEqual((await response.json()).findings, []);
});
test('a later inference failure returns no partial fiscal-code finding', async () => {
  const response = await post({ fields: [field('RSSMRA85M01H501Q'), field('THROW', 'contactName')] });
  assert.equal(response.status, 503);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body), { code: 'ANALYZER_UNAVAILABLE' });
  assert.ok(!body.includes('RSSMRA'));
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
test('preflight every field before rules and inference, then run both and union per-field policy', async () => {
  const events = [];
  const handler = createHandler({
    ready: async () => true,
    prepare: async text => { events.push(`prepare:${text}`); return { text }; },
    recognize: text => { events.push(`rules:${text}`); return text === 'FIRST'
      ? [{ category: 'IT_FISCAL_CODE', source: 'rule', start: 0, end: 5, check: 'not_checked' }]
      : []; },
    infer: async ({ text }) => { events.push(`infer:${text}`); return text === 'FIRST'
      ? [{ entity_group: 'PERSON', score: 0.9, start: 0, end: 5 }]
      : []; },
  });
  const local = createServer(handler);
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field('FIRST', 'description', ['IT_FISCAL_CODE']),
        field('SECOND', 'contactName', [])] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).findings,
      [{ fieldId: 'description', entityType: 'PERSON' }]);
    assert.deepEqual(events, ['prepare:FIRST', 'prepare:SECOND',
      'rules:FIRST', 'infer:FIRST', 'rules:SECOND', 'infer:SECOND']);
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('preflight failure on later field executes neither rules nor inference', async () => {
  const events = [];
  const local = createServer(createHandler({
    ready: async () => true,
    prepare: text => { events.push(`prepare:${text}`); if (text === 'SECOND') throw Error('OVER');
      return { text }; },
    recognize: text => { events.push(`rules:${text}`); return []; },
    infer: async ({ text }) => { events.push(`infer:${text}`); return []; },
  }));
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field('FIRST'), field('SECOND', 'contactName')] }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'ANALYZER_UNAVAILABLE' });
    assert.deepEqual(events, ['prepare:FIRST', 'prepare:SECOND']);
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('full label mapping and threshold, no false equivalence', () => {
  assert.equal(Object.keys(LABEL_MAP).length, 29);
  assert.equal(CATEGORIES.size, 7);
  assert.equal(CATEGORIES.has('TAX_ID'), false);
  assert.ok(CATEGORIES.has('IT_FISCAL_CODE'));
  assert.deepEqual([...categoriesOf([{entity_group:'TAX_ID',score:0.9},
    {entity_group:'PERSON',score:0.2}])], []);
  assert.throws(() => categoriesOf([{entity_group:'UNKNOWN',score:0.8}]));
});

test('HTTP ignores known native extras but fails closed for unknown labels and malformed candidates', async () => {
  const local = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }),
    infer: async ({ text }) => text === 'UNKNOWN'
      ? [{ entity_group: 'NEW_LABEL', score: 0.01 }]
      : text === 'BAD_SPAN'
        ? [{ entity_group: 'PERSON', score: 0.9, start: 0, end: 99 }]
        : [{ entity_group: 'BANK_ACCOUNT', score: 0.9 }],
  }));
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    for (const [text, status, body] of [
      ['KNOWN', 200, 'accepted'], ['UNKNOWN', 503, 'ANALYZER_UNAVAILABLE'],
      ['BAD_SPAN', 503, 'ANALYZER_UNAVAILABLE'],
    ]) {
      const response = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: [field(text)] }),
      });
      assert.equal(response.status, status);
      const result = await response.json();
      assert.equal(result.verdict ?? result.code, body);
      assert.deepEqual(result.findings ?? [], []);
    }
  } finally { await new Promise(resolve => local.close(resolve)); }
});
