import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../../poc-horizon/src/server.mjs';

async function withService(options, run) {
  const server = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }), infer: async () => [], ...options }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const send = (body, { path = '/v1/analyze', method = 'POST', headers = { 'Content-Type': 'application/json' } } = {}) =>
    fetch(url + path, { method, headers, body: method === 'GET' ? undefined :
      typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
  try { await run(send); } finally { await new Promise(resolve => server.close(resolve)); }
}
const field = (text = '', fieldId = 'custom', allowedCategories) =>
  ({ fieldId, text, ...(allowedCategories === undefined ? {} : { allowedCategories }) });
const accepted = { verdict: 'accepted', findings: [] };

test('uniform validation has closed schema, Unicode word/ID limits and duplicate-key rejection', async () => {
  let calls = 0;
  await withService({ infer: async () => { calls++; return []; } }, async send => {
    for (const body of [
      { fields: Array.from({ length: 10 }, (_, i) => field('', `${i}`)) },
      { fields: [field('x\u0085'.repeat(50), '🙂'.repeat(64))] },
      { fields: [field('x\u001cy'.repeat(2000), '\ufeff')] },
      { fields: [field('x'.repeat(40000))] },
    ]) {
      const response = await send(body);
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), accepted);
    }
    const before = calls;
    for (const body of [
      { fields: Array.from({ length: 11 }, (_, i) => field('', `${i}`)) },
      { fields: [field('x\u0085'.repeat(51))] },
      { fields: [field('', '🙂'.repeat(64) + 'x')] },
      { fields: [field('', '')] },
      { fields: [field('', '\ud800')] },
      { fields: [field('\udc00')] },
      { fields: [field('', 'a'), field('', 'a')] },
      { fields: [field('', 'a', ['EMAIL'])] },
      { fields: [field('', 'a', null)] },
      { fields: [field()], extra: 1 },
      { fields: [{ ...field(), extra: 1 }] },
      { fields: [{ fieldId: 'a' }] },
      '{"fields":[],"\\u0066ields":[{"fieldId":"a","text":""}]}',
      '{"fields":[{"fieldId":"a","text":"","\\u0074ext":""}]}',
      Buffer.from([0xff]),
    ]) {
      const response = await send(body);
      assert.equal(response.status, 400, JSON.stringify(body));
      assert.deepEqual(await response.json(), { code: 'invalid_request' });
    }
    assert.equal(calls, before);
  });
});

test('routing/content-type/body/validation/detector error precedence is uniform', async () => {
  await withService({ ready: async () => { throw Error('PRIVATE'); },
    infer: async () => { throw Error('PRIVATE'); } }, async send => {
    for (const options of [
      { path: '/v1/analyze/' }, { path: '/v1/analyze?x=1' },
      { path: '/v1/%61nalyze' }, { method: 'PUT' },
      { path: '/health/ready?x=1', method: 'GET' },
    ]) {
      const response = await send('invalid', options);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { code: 'not_found' });
    }
    const oversized = ' '.repeat(1048577);
    for (const [body, options, status, code] of [
      [oversized, { headers: { 'Content-Type': 'text/plain' } }, 400, 'invalid_request'],
      [oversized, {}, 413, 'body_too_large'],
      [' '.repeat(1048576), {}, 400, 'invalid_request'],
      [{ fields: [] }, {}, 400, 'invalid_request'],
      [{ fields: [field()] }, { headers: { 'Content-Type': 'Application/JSON ; charset=UTF-8' } }, 503, 'detector_unavailable'],
      [null, { path: '/health/ready', method: 'GET' }, 503, 'detector_unavailable'],
    ]) {
      const response = await send(body, options);
      assert.equal(response.status, status);
      assert.deepEqual(await response.json(), { code });
    }
  });
});

test('canonical findings use UTF-16 ordering, not locale or Unicode scalar ordering', async () => {
  await withService({ infer: async () => [
    { entity_group: 'PERSON', score: 0.9 }, { entity_group: 'EMAIL', score: 0.9 },
    { entity_group: 'PERSON', score: 0.8 },
  ] }, async send => {
    const response = await send({ fields: ['\ue000', '🙂', 'a', 'Z'].map(id => field('', id)) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).findings,
      ['Z', 'a', '🙂', '\ue000'].flatMap(fieldId =>
        ['EMAIL_ADDRESS', 'PERSON'].map(category => ({ fieldId, category }))));
  });
});

test('native phone aliases and rule producer share policy, with Italian-only geography', async () => {
  for (const value of ['3331234567', '+39 3331234567', '+44 20 8366 1177', '+1 (213) 373-4253']) {
    await withService({ infer: async ({ text }) => ['PHONE', 'PHONE_NUMBER'].map(entity_group =>
      ({ entity_group, score: 0.9, start: text.indexOf(value), end: text.length })) }, async send => {
      for (const allowed of [[], ['PHONE_NUMBER']]) {
        const response = await send({ fields: [field(`telefono ${value}`, 'a', allowed)] });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), allowed.length || value.startsWith('+44') || value.startsWith('+1')
          ? accepted : { verdict: 'rejected', findings: [{ fieldId: 'a', category: 'PHONE_NUMBER' }] });
      }
    });
  }
});

test('native documents map only Italian forms in original standalone or contextual text', async () => {
  for (const [label, category, value, context] of [
    ['NATIONAL_ID', 'IT_IDENTITY_CARD', 'CA12345AA', 'carta di identità: '],
    ['NATIONAL_ID', 'IT_IDENTITY_CARD', '1234567AB', 'CIE: '],
    ['DRIVER_LICENSE', 'IT_DRIVER_LICENSE', 'AB1234567C', 'patente: '],
    ['DRIVER_LICENSE', 'IT_DRIVER_LICENSE', 'U1B234567C', 'patente: '],
  ]) {
    await withService({ infer: async ({ text }) => [{ entity_group: label, score: 0.9,
      start: text.indexOf(value) >= 0 ? text.indexOf(value) : 0,
      end: text.indexOf(value) >= 0 ? text.indexOf(value) + value.length : text.length }] }, async send => {
      for (const [text, allowed, expected] of [
        [value, [], [category]], [context + value, [], [category]],
        [context + value, [category], []], ['foreign document 123-45-6789', [], []],
        ['unrelated item ' + value, [], []], [context + 'x' + value, [], []],
        [context + value + '\u0301', [], []],
      ]) {
        const response = await send({ fields: [field(text, 'a', allowed)] });
        assert.equal(response.status, 200);
        assert.deepEqual((await response.json()).findings, expected.map(category => ({ fieldId: 'a', category })));
      }
    });
  }
});

test('malformed native containers/candidates and genuinely unknown labels fail closed before policy', async () => {
  for (const results of ['', {}, null, [null], [[]], [{ entity_group: 'PERSON', score: '0.9' }],
    [{ entity_group: 'LOCATION', score: -1 }], [{ entity_group: 'LOCATION', score: NaN }],
    [{ entity_group: 'LOCATION', score: 0.9, start: 0, end: 999 }],
    [{ entity_group: '__proto__', score: 0.9 }], [{ entity_group: 'toString', score: 0.9 }],
    [{ entity_group: 'UNKNOWN_NATIVE', score: 0.01 }]]) {
    await withService({ infer: async () => results }, async send => {
      const response = await send({ fields: [field('plain', 'a', ['PERSON'])] });
      assert.equal(response.status, 503, JSON.stringify(results));
      assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
    });
  }
});

test('all nine canonical aliases traverse the real HTTP adapter and field policy', async () => {
  const examples = [
    ['PERSON', 'Ada Verdi'], ['EMAIL_ADDRESS', 'ada@example.test'],
    ['PHONE_NUMBER', '3331234567'], ['IT_FISCAL_CODE', 'RSSMRA85M01H501Q'],
    ['IT_VAT_CODE', '12345678903'], ['IBAN_CODE', 'IT60X0542811101000000123456'],
    ['CREDIT_CARD', '4111 1111 1111 1111'], ['IT_IDENTITY_CARD', 'CA12345AA'],
    ['IT_DRIVER_LICENSE', 'AB1234567C'],
  ];
  await withService({ infer: async ({ text }) => {
    const [entity_group] = examples.find(([, value]) => value === text);
    return [{ entity_group, score: 0.9, start: 0, end: text.length }];
  } }, async send => {
    const denied = await send({ fields: examples.map(([category, value]) => field(value, category)) });
    assert.equal(denied.status, 200);
    assert.deepEqual(await denied.json(), { verdict: 'rejected', findings:
      examples.map(([category]) => category).sort().map(category => ({ fieldId: category, category })) });
    const allowed = await send({ fields: examples.map(([category, value]) => field(value, category, [category])) });
    assert.equal(allowed.status, 200);
    assert.deepEqual(await allowed.json(), accepted);
  });
});

test('uniform HTTP maps native email, filters extras before policy, and projects business output', async () => {
  await withService({ infer: async ({ text }) => [
    { entity_group: 'LOCATION', score: 0.99 },
    ...(text ? [{ entity_group: 'EMAIL', score: 0.9, word: 'PRIVATE_SENTINEL' }] : []),
  ] }, async send => {
    for (const [input, expected] of [
      [field(), accepted],
      [field('mail'), { verdict: 'rejected', findings: [{ fieldId: 'custom', category: 'EMAIL_ADDRESS' }] }],
      [field('mail', 'custom', ['EMAIL_ADDRESS', 'EMAIL_ADDRESS']), accepted],
    ]) {
      const response = await send({ fields: [input] });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), expected);
    }
  });
});
