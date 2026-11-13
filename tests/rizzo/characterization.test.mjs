import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { mkdtemp, writeFile, rm, realpath } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { createServer } from './support/http.mjs';
import { createDetector } from './support/detector.mjs';
import { createInference } from './support/model.mjs';

async function socket(t, detect) {
  const server = createServer({ detect });
  const defaults = http.createServer();
  for (const key of ['timeout', 'requestTimeout', 'headersTimeout', 'keepAliveTimeout', 'maxRequestsPerSocket']) assert.equal(server[key], defaults[key], key);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return 'http://127.0.0.1:' + server.address().port;
}
const post = (base, fields) => fetch(base + '/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });

test('Rizzo model executes before rules and failure prevents rule collection', async () => {
  const trace = [];
  const marker = new Error('synthetic failure');
  const detect = await createDetector({ modelFactory: async () => async text => {
    trace.push(text);
    if (text === 'synthetic@example.test fail') throw marker;
    return new Set(['PERSON']);
  } });
  assert.deepEqual([...await detect('synthetic@example.test')], ['PERSON', 'EMAIL_ADDRESS']);
  await assert.rejects(() => detect('synthetic@example.test fail'), error => error === marker);
  assert.deepEqual(trace, ['synthetic@example.test', 'synthetic@example.test fail']);
});

test('field-local preflight is sequential, not global, and late failure returns no partial findings', async t => {
  const trace = [];
  const infer = createInference({ tokenizer: text => { trace.push('preflight:' + text); return { input_ids: { data: text === 'second' ? [1, 2] : [1] } }; }, pipeline: async text => { trace.push('model:' + text); return [{ entity_group: 'FULLNAME', word: 'synthetic', score: .9 }]; }, maxTokens: 1 });
  const detect = await createDetector({ modelFactory: async () => infer });
  const base = await socket(t, detect);
  const response = await post(base, [{ fieldId: 'a', text: 'first' }, { fieldId: 'b', text: 'second' }]);
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
  assert.deepEqual(trace, ['preflight:first', 'model:first', 'preflight:second']);
});

test('requests run concurrently without a global queue; HTTP framing and timeout defaults remain Node-owned', async t => {
  let entered = 0;
  let release;
  const held = new Promise(resolve => { release = resolve; });
  let both;
  const arrived = new Promise(resolve => { both = resolve; });
  const base = await socket(t, async () => { if (++entered === 2) both(); await held; return new Set(); });
  const a = post(base, [{ fieldId: 'a', text: 'first' }]);
  const b = post(base, [{ fieldId: 'b', text: 'second' }]);
  const timer = setTimeout(() => { release(); both(); }, 2000);
  await arrived;
  clearTimeout(timer);
  assert.equal(entered, 2, 'both requests must enter before either is released');
  release();
  for (const response of await Promise.all([a, b])) {
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
    assert.equal(response.headers.get('content-length'), null);
    assert.equal(response.headers.get('transfer-encoding'), 'chunked');
    assert.deepEqual(await response.json(), { verdict: 'accepted', findings: [] });
  }
  const large = await post(base, [{ fieldId: 'x', text: 'x'.repeat(1024 * 1024) }]);
  assert.equal(large.status, 413);
  assert.equal(large.headers.get('connection'), 'close');
  assert.deepEqual(await large.json(), { code: 'body_too_large' });
});

test('initialization rejection is sticky and later options never replace the first initialization', async t => {
  const scratch = await realpath(tmpdir());
  assert.equal(scratch, await realpath(process.env.TMPDIR));
  const dir = await mkdtemp(join(scratch, 'rizzo-sticky-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = JSON.stringify({ max_position_embeddings: 3 });
  const tokenizer = JSON.stringify({ version: '1.0', truncation: null, padding: null, added_tokens: [], normalizer: null, pre_tokenizer: { type: 'Whitespace' }, post_processor: null, decoder: null, model: { type: 'WordLevel', vocab: { '[UNK]': 0, Ada: 1 }, unk_token: '[UNK]' } });
  const files = { 'config.json': config, 'tokenizer.json': tokenizer, 'model.onnx': 'synthetic' };
  for (const [name, content] of Object.entries(files)) await writeFile(join(dir, name), content);
  await writeFile(join(dir, 'manifest.json'), JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')])) }));
  const { createModel } = await import('./support/model.mjs?sticky=' + encodeURIComponent(dir));
  const failure = new Error('synthetic loader failure');
  let first = 0, second = 0;
  const a = createModel({ directory: pathToFileURL(dir + '/'), manifestPath: pathToFileURL(join(dir, 'manifest.json')), loadModel: async (path, options) => { first++; assert.equal(path, dir + '/'); assert.deepEqual(options, { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true }); throw failure; } });
  const alternate = { directory: pathToFileURL(dir + '/absent/'), loadModel: async () => { second++; } };
  const b = createModel(alternate);
  assert.equal(a, b);
  for (const promise of [a, b]) await assert.rejects(promise, error => error === failure);
  assert.equal(createModel(alternate), a);
  await assert.rejects(createModel(alternate), error => error === failure);
  assert.equal(first, 1);
  assert.equal(second, 0);
});
