import { test } from 'node:test';
import assert from 'node:assert/strict';
import { post } from '../http-client.mjs';

const invoke = fetchFn => post('http://127.0.0.1:1', '{}', {
  fetchFn, timeoutMs: 1000 });

test('a received HTTP response with wrong content type is a hard contract failure', async () => {
  for (const contentType of ['text/plain', 'application/json-invalid']) {
    await assert.rejects(() => invoke(async () => new Response('{"verdict":"accepted"}', {
      status: 200, headers: { 'content-type': contentType },
    })), { message: 'INVALID_RESPONSE' });
  }
  const valid = await invoke(async () => new Response('{"verdict":"accepted"}', {
    status: 200, headers: { 'content-type': 'application/json; charset=utf-8' },
  }));
  assert.equal(valid.status, 200);
});

test('a received HTTP response with malformed JSON is a hard contract failure without raw body', async () => {
  const error = await invoke(async () => new Response('SENTINELSECRET', {
    status: 200, headers: { 'content-type': 'application/json' },
  })).catch(x => x);
  assert.equal(error.message, 'INVALID_RESPONSE');
  assert.ok(!JSON.stringify(error).includes('SENTINELSECRET'));
});

test('functional HTTP captures outcome only, without performance metrics', async () => {
  const response = await invoke(async (url, options) => {
    assert.equal(url, 'http://127.0.0.1:1/v1/analyze');
    assert.equal(options.method, 'POST');
    return new Response('{"verdict":"accepted"}', { headers: { 'content-type': 'application/json' } });
  });
  assert.deepEqual(Object.keys(response).sort(), ['body', 'status']);
  const failure = await invoke(async () => { throw new Error('offline'); });
  assert.deepEqual(failure, { status: 0, body: null });
});

test('transport failure remains a separately counted technical outcome', async () => {
  const r = await invoke(async () => { throw new Error('SENTINELSECRET'); });
  assert.equal(r.status, 0);
  assert.equal(r.body, null);
  assert.ok(!JSON.stringify(r).includes('SENTINELSECRET'));
});
