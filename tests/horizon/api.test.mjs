import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from './create-test-app.mjs';
import { categoriesOf, CATEGORIES, LABEL_MAP } from '../../poc-horizon/dist/model/categories.js';
import { vatCandidates } from '../../poc-horizon/dist/recognizers/vat.js';
import { italianIbanCandidates } from '../../poc-horizon/dist/recognizers/italian-iban.js';

let server, url;
before(async () => {
  server = createServer(createHandler({
    ready: async () => true,
    prepare: text => ({ text }),
    infer: async ({ text }) => {
      if (text === 'THROW') throw Error('SENTINELSECRET');
      if (text.includes('NATIVE')) return [{ entity_group: 'LICENSE_NUMBER', score: 0.9,
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
const field = (text, fieldId = 'description', allowedCategories = []) =>
  ({ text, fieldId, allowedCategories });
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
    findings: [] });
});
test('recognizes a synthetic fiscal-code-shaped value through the HTTP API', async () => {
  const response = await post({ fields: [field('RSSMRA85M01H501Q')] });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body).findings,
    [{ fieldId: 'description', category: 'IT_FISCAL_CODE' }]);
  assert.ok(!body.includes('RSSMRA'));
});
test('recognizes multiple occurrences once and accepts an allowlisted fiscal code', async () => {
  const text = 'Codice fiscale: RSSMRA85M01H501Q; rssmra85m01h501q.';
  const rejected = await post({ fields: [field(text)] });
  assert.deepEqual((await rejected.json()).findings,
    [{ fieldId: 'description', category: 'IT_FISCAL_CODE' }]);
  const allowed = await post({ fields: [field(text, 'description', ['IT_FISCAL_CODE'])] });
  assert.equal(allowed.status, 200);
  assert.deepEqual(await allowed.json(), { verdict: 'accepted',
    findings: [] });
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
  assert.deepEqual(JSON.parse(body), { code: 'detector_unavailable' });
  assert.ok(!body.includes('RSSMRA'));
  assert.ok(!body.includes('IT_FISCAL_CODE'));
});
test('rejects email without text; allowlist applies after recognition', async () => {
  const response = await post({ fields: [field('mario.rossi@example.com')] });
  assert.equal(response.status, 200);
  const body = await response.text();
  assert.deepEqual(JSON.parse(body).findings,
    [{ fieldId: 'description', category: 'EMAIL_ADDRESS' }]);
  assert.ok(!body.includes('mario.rossi'));
  const exempt = await post({ fields: [field('mario.rossi@example.com', 'description', ['EMAIL_ADDRESS'])] });
  assert.equal(exempt.status, 200);
  assert.deepEqual((await exempt.json()).findings, []);
  const allowed = await post({ fields: [field('Mario Rossi', 'description', ['PERSON'])] });
  assert.equal((await allowed.json()).verdict, 'accepted');
});
test('Italian document labels survive the semantic adapter and business allowlists', async () => {
  for (const [label, category, text] of [
    ['NATIONAL_ID', 'IT_IDENTITY_CARD', 'CA12345AA'],
    ['DRIVER_LICENSE', 'IT_DRIVER_LICENSE', 'AB1234567C'],
  ]) {
    const local = createServer(createHandler({ ready: async () => true,
      prepare: text => ({ text }), recognize: () => [],
      infer: async () => [{ entity_group: label, score: 0.9, start: 0, end: text.length }],
    }));
    await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
    try {
      const request = allowedCategories => fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fields: [field(text, 'description', allowedCategories)] }),
      });
      const denied = await request([]);
      assert.equal(denied.status, 200);
      assert.deepEqual((await denied.json()).findings, [{ fieldId: 'description', category }]);
      const allowed = await request([category]);
      assert.equal(allowed.status, 200);
      assert.deepEqual(await allowed.json(), { verdict: 'accepted',
        findings: [] });
    } finally { await new Promise(resolve => local.close(resolve)); }
  }
});

test('HTTP unifies both native phone producers before business allowlisting', async () => {
  const text = '0212345678'; // Metadata example; not an assignment claim.
  const local = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }),
    infer: async ({ text: input }) => [{ entity_group: 'PHONE', score: 0.9,
      start: 0, end: input.length }],
  }));
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const request = allowedCategories => fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field(text, 'description', allowedCategories)] }),
    });
    for (const [allowed, expected] of [
      [[], ['PHONE_NUMBER']],
      [['PHONE_NUMBER'], []],
      [['PHONE_NUMBER', 'PHONE_NUMBER'], []],
    ]) {
      const response = await request(allowed);
      assert.equal(response.status, 200);
      assert.deepEqual((await response.json()).findings.map(f => f.category), expected);
    }
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('malformed phone envelope cannot escape native model span gate over HTTP', async () => {
  const text = '+999 02 1234 5678';
  const local = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }), infer: async () => [{ entity_group: 'PHONE', score: 0.9,
      start: text.indexOf('02'), end: text.length }],
  }));
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field(text)] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { verdict: 'accepted',
      findings: [] });
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('late model failure discards a prior native document finding', async () => {
  const local = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }), recognize: () => [],
    infer: async ({ text }) => { if (text === 'FAIL') throw Error('SENTINELSECRET');
      return [{ entity_group: 'DRIVER_LICENSE', score: 0.9, start: 0, end: text.length }]; },
  }));
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field('AB1234567C'), field('FAIL', 'contactName')] }),
    });
    assert.equal(response.status, 503);
    assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('all nine business labels form an accepted HTTP allowlist', async () => {
  const allowed = [...CATEGORIES];
  assert.equal(allowed.length, 9);
  const response = await post({ fields: [field('mario.rossi@example.com', 'description', allowed)] });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verdict: 'accepted',
    findings: [] });
});

test('PERSON and native document remain independently forbidden over the same span', async () => {
  const local = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }), recognize: () => [],
    infer: async () => [{ entity_group: 'PERSON', score: 0.9 },
      { entity_group: 'NATIONAL_ID', score: 0.9, start: 0, end: 9 }],
  }));
  await new Promise(resolve => local.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${local.address().port}/v1/analyze`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [field('CA12345AA', 'description', ['PERSON'])] }),
    });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).findings,
      [{ fieldId: 'description', category: 'IT_IDENTITY_CARD' }]);
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('duplicate keys, duplicate IDs, invalid categories and too many words are 400', async () => {
  for (const body of [
    '{"fields":[],"fields":[{"fieldId":"description","text":"SENTINELSECRET","allowedCategories":[] }]}',
    '{"fields":[{"fieldId":"description","fieldId":"description","text":"SENTINELSECRET","allowedCategories":[]}]}',
    '{"fields":[],"\\u0066ields":[{"fieldId":"description","text":"SENTINELSECRET","allowedCategories":[]}]}',
    { fields: [field('SENTINELSECRET'), field('SENTINELSECRET')] },
    { fields: [field('SENTINELSECRET','description',['PHONE'])] },
    { fields: [field('SENTINELSECRET','')] },
    { fields: [field('SENTINELSECRET','description',['UNKNOWN_CATEGORY'])] },
    { fields: [field('SENTINELSECRET','description',['EMAIL'])] },
    { fields: [field('SENTINELSECRET','description',['LICENSE_NUMBER'])] },
    { fields: [field('SENTINELSECRET '.repeat(51))] },
    ' '.repeat(33000),
  ]) {
    const response = await post(body);
    assert.equal(response.status, 400);
    const text = await response.text();
    assert.equal(text, '{"code":"invalid_request"}');
    assert.ok(!text.includes('SENTINELSECRET'));
  }
});
test('invalid UTF-8 fails before inference without echo', async () => {
  const response = await fetch(url + '/v1/analyze', { method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body:Buffer.concat([Buffer.from('{"fields":[{"fieldId":"description","text":"'),
      Buffer.from([0xff]), Buffer.from('","allowedCategories":[]}]}')]),
  });
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { code: 'invalid_request' });
});

test('second-field error is fail-closed without a partial verdict', async () => {
  const response = await post({ fields: [field('Servizio digitale.'), field('THROW','contactName')] });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
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
      [{ fieldId: 'description', category: 'PERSON' }]);
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
    assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
    assert.deepEqual(events, ['prepare:FIRST', 'prepare:SECOND']);
  } finally { await new Promise(resolve => local.close(resolve)); }
});

test('full label mapping and threshold, no false equivalence', () => {
  assert.equal(Object.keys(LABEL_MAP).length, 29);
  assert.equal(CATEGORIES.size, 9);
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
      ['KNOWN', 200, 'accepted'], ['UNKNOWN', 503, 'detector_unavailable'],
      ['BAD_SPAN', 503, 'detector_unavailable'],
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
