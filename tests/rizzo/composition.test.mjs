import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import * as app from '../../poc-rizzo/dist/app.js';
import * as entrypoint from '../../poc-rizzo/dist/index.js';
import { analyzeFields } from './support/http.mjs';
import { readHttpConfig } from '../../poc-rizzo/dist/config/config.js';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, child } from './support/sandbox.mjs';

test('startup rejects a failed warmup before creating or listening to any server', async () => {
  assert.equal(typeof entrypoint.startup, 'function', 'TESTABLE_STARTUP_REQUIRED');
  const trace = [], marker = new Error('SENSITIVE_SENTINEL');
  await assert.rejects(() => entrypoint.startup({
    warmup: async () => { trace.push('warmup'); await new Promise(resolve => setImmediate(resolve)); throw marker; },
    createServer: () => { trace.push('create'); throw Error('must never create'); },
  }), error => error === marker);
  assert.deepEqual(trace, ['warmup']);
});

async function socket(t, dependencies) {
  assert.equal(typeof app.createApp, 'function', 'CREATE_APP_EXPLICIT_DI_REQUIRED');
  const listener = app.createApp(dependencies);
  assert.equal(typeof listener, 'function');
  const server = http.createServer(listener);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, base: 'http://127.0.0.1:' + server.address().port };
}

test('createApp is a real RequestListener with explicit readiness and analysis dependencies', async t => {
  const trace = [];
  const { base } = await socket(t, { analysisService: async () => { trace.push('analysis'); return []; }, ready: () => { trace.push('ready'); return 'truthy'; } });
  const response = await fetch(base + '/health/ready');
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { status: 'ready' });
  assert.deepEqual(trace, ['ready']);
});

const field = (fieldId = 'a', text = '') => ({ fieldId, text });
const post = (base, fields) => fetch(base + '/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };

async function deadline(promise) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(Error('concurrency proof timed out')), 2000); })]); }
  finally { clearTimeout(timer); }
}

test('HTTP validates all fields before readiness or detection and normalizes only absent allowlists', async t => {
  const trace = [];
  const { base } = await socket(t, {
    ready: () => { trace.push('ready'); return true; },
    analysisService: fields => { trace.push(['analysis', fields]); return analyzeFields(fields, text => { trace.push(['detect', text]); return new Set(['PERSON']); }); },
  });
  for (const invalid of [
    { ...field('b'), allowedCategories: null }, { ...field('b'), allowedCategories: ['UNKNOWN'] },
    field('b', '\ud800'), field('b', 'word\u0085'.repeat(51)), field('a'), { ...field('b'), extra: true },
  ]) {
    const response = await post(base, [field('a', 'first'), invalid]);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { code: 'invalid_request' });
    assert.deepEqual(trace, []);
  }
  const response = await post(base, [field('b', 'one'), { ...field('a', 'two'), allowedCategories: ['PERSON', 'PERSON'] }]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verdict: 'rejected', findings: [{ fieldId: 'b', category: 'PERSON' }] });
  assert.deepEqual(trace, ['ready', ['analysis', [
    { fieldId: 'b', text: 'one', allowedCategories: [] },
    { fieldId: 'a', text: 'two', allowedCategories: ['PERSON', 'PERSON'] },
  ]], ['detect', 'one'], ['detect', 'two']]);
});

for (const [label, ready, status] of [
  ['false', () => false, 503], ['zero', () => 0, 503], ['empty', () => '', 503],
  ['throw', () => { throw Error('SENSITIVE_SENTINEL'); }, 503],
  ['reject', async () => { throw Error('SENSITIVE_SENTINEL'); }, 503],
  ['truthy-object', () => ({}), 200], ['truthy-string', async () => 'ready', 200],
]) test('readiness retains legacy truthiness for health and analysis: ' + label, async t => {
  let readyCalls = 0, detects = 0;
  const { base } = await socket(t, { ready: () => { readyCalls++; return ready(); }, analysisService: fields => analyzeFields(fields, () => { detects++; return new Set(); }) });
  const invalid = await post(base, []);
  assert.equal(invalid.status, 400); await invalid.arrayBuffer();
  assert.equal(readyCalls, 0);
  for (const response of [await fetch(base + '/health/ready'), await post(base, [field()])]) {
    assert.equal(response.status, status);
    assert.deepEqual(await response.json(), status === 503 ? { code: 'detector_unavailable' } : response.url.endsWith('/health/ready') ? { status: 'ready' } : { verdict: 'accepted', findings: [] });
  }
  assert.equal(readyCalls, 2);
  assert.equal(detects, status === 503 ? 0 : 1);
});

test('health completes during blocked analysis and independent requests enter detection before release', async t => {
  const hold = deferred(), allEntered = deferred();
  let entered = 0;
  t.after(() => hold.resolve());
  const { base } = await socket(t, { ready: () => true, analysisService: fields => analyzeFields(fields, async () => { if (++entered === 3) allEntered.resolve(); await hold.promise; return new Set(); }) });
  const pending = [post(base, [field('a')]), post(base, [field('b')]), post(base, [field('c')])];
  try {
    await deadline(allEntered.promise);
    assert.equal(entered, 3);
    const health = await deadline(fetch(base + '/health/ready'));
    assert.equal(health.status, 200);
    assert.deepEqual(await health.json(), { status: 'ready' });
  } finally { hold.resolve(); }
  for (const response of await Promise.all(pending)) { assert.equal(response.status, 200); await response.arrayBuffer(); }
});

test('field policy awaits each field before starting the next and returns no partial findings on late failure', async t => {
  const hold = deferred(), firstEntered = deferred(), trace = [];
  t.after(() => hold.resolve());
  const { base } = await socket(t, { ready: () => true, analysisService: fields => analyzeFields(fields, async text => {
    trace.push(text);
    if (text === 'first') { firstEntered.resolve(); await hold.promise; return new Set(['PERSON']); }
    throw Error('SENSITIVE_SENTINEL');
  }) });
  const pending = post(base, [field('a', 'first'), field('b', 'second')]);
  try { await deadline(firstEntered.promise); await new Promise(resolve => setImmediate(resolve)); assert.deepEqual(trace, ['first']); }
  finally { hold.resolve(); }
  const response = await pending;
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
  assert.deepEqual(trace, ['first', 'second']);
});

test('startup uses a real port-zero server only after warmup and readiness remains true after inference failure', async t => {
  const hold = deferred(), trace = [];
  t.after(() => hold.resolve());
  const starting = entrypoint.startup({ warmup: async () => { trace.push('warmup'); await hold.promise; trace.push('warmed'); return async () => { throw Error('SENSITIVE_SENTINEL'); }; },
    createServer: listener => { trace.push('create'); return http.createServer(listener); }, config: { port: 0, host: '127.0.0.1' }, onServerError: error => { throw error; } });
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(trace, ['warmup']);
  hold.resolve();
  const server = await starting;
  if (!server.listening) await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  assert.deepEqual(trace, ['warmup', 'warmed', 'create']);
  assert.equal(server.address().address, '127.0.0.1');
  assert.ok(server.address().port > 0);
  const defaults = http.createServer();
  for (const key of ['timeout', 'requestTimeout', 'headersTimeout', 'keepAliveTimeout', 'maxRequestsPerSocket']) assert.equal(server[key], defaults[key], key);
  const base = 'http://127.0.0.1:' + server.address().port;
  const failed = await post(base, [field()]);
  assert.equal(failed.status, 503); assert.deepEqual(await failed.json(), { code: 'detector_unavailable' });
  const health = await fetch(base + '/health/ready');
  assert.equal(health.status, 200); assert.deepEqual(await health.json(), { status: 'ready' });
});

test('API converter projects only category pairs and sorts UTF16 without exposing service details', async t => {
  const { base } = await socket(t, { ready: () => true, analysisService: () => [
    { fieldId: '\ue000', category: 'PERSON', text: 'SENSITIVE_SENTINEL', score: 1, stack: 'SENSITIVE_SENTINEL' },
    { fieldId: '😀', category: 'PERSON', native: { text: 'SENSITIVE_SENTINEL' } },
  ] });
  const response = await post(base, [field()]);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { verdict: 'rejected', findings: [{ fieldId: '😀', category: 'PERSON' }, { fieldId: '\ue000', category: 'PERSON' }] }, 'API_CONVERTER_PROJECTION_REQUIRED');
});

test('HTTP environment config preserves Number coercions, defaults, empty values and access order', () => {
  assert.deepEqual(readHttpConfig({}), { port: 8000, host: '127.0.0.1' });
  for (const raw of ['0', '', ' 0 ', '0x10', '1e2', '-1', 'NaN', 'not-a-port']) {
    const actual = readHttpConfig({ PORT: raw, BIND_HOST: '' });
    assert.ok(Object.is(actual.port, Number(raw)));
    assert.equal(actual.host, '');
  }
  const trace = [];
  assert.deepEqual(readHttpConfig({ get PORT() { trace.push('PORT'); return '0'; }, get BIND_HOST() { trace.push('BIND_HOST'); return '127.0.0.1'; } }), { port: 0, host: '127.0.0.1' });
  assert.deepEqual(trace, ['PORT', 'BIND_HOST']);
});

test('importing app and entrypoint performs no SDK resolution, model IO, fetch, server construction or listen', async t => {
  const { pkg, cwd } = await sandbox(t);
  const code = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import fs from 'node:fs';
    import promises from 'node:fs/promises';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const trace = [];
    registerHooks({ resolve(specifier, context, next) {
      if (/huggingface|onnxruntime|ibantools|(?:^|\\/)detector\\.js$|(?:^|\\/)model\\.js$/.test(specifier)) { trace.push('SDK'); throw Error('forbidden SDK import'); }
      return next(specifier, context);
    } });
    for (const owner of [fs, promises]) for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) if (typeof owner[name] === 'function') {
      const original = owner[name]; owner[name] = function(path, ...args) { if (String(path).includes('/models/') || String(path).includes('model-manifest.json')) { trace.push('model IO'); throw Error('forbidden model IO'); } return original.call(this, path, ...args); };
    }
    http.createServer = () => { trace.push('create'); throw Error('forbidden create'); };
    http.Server.prototype.listen = () => { trace.push('listen'); throw Error('forbidden listen'); };
    globalThis.fetch = () => { trace.push('fetch'); throw Error('forbidden fetch'); };
    syncBuiltinESMExports();
    const app = await import(${JSON.stringify(pathToFileURL(join(pkg, 'dist/app.js')).href)});
    const index = await import(${JSON.stringify(pathToFileURL(join(pkg, 'dist/index.js')).href)});
    assert.equal(typeof app.createApp, 'function'); assert.equal(typeof index.startup, 'function'); assert.equal(typeof index.main, 'function');
    assert.equal('createServer' in app, false);
    assert.deepEqual(trace, []);
    console.log('IMPORT_SAFE_NO_SDK_IO_SOCKET');
  `;
  const result = child(code, cwd);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'IMPORT_SAFE_NO_SDK_IO_SOCKET\n');
});

