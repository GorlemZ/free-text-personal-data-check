import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import * as api from '../../poc-rizzo/dist/index.js';
import { tokenizerJSON } from './support/legacy-startup.mjs';
import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sandbox, child } from './support/sandbox.mjs';
import { modelDetectionServiceBuilder } from '../../poc-rizzo/dist/services/modelDetectionService.js';

test('lazy adapter owns one sticky initialization promise per explicit instance and first options win', async t => {
  assert.equal(typeof api.transformersAdapterBuilder, 'function', 'LAZY_INSTANCE_ADAPTER_REQUIRED');
  const dir = await mkdtemp(join(tmpdir(), 'rizzo-C-adapter-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'manifest.json'), '{"files":{}}');
  await writeFile(join(dir, 'config.json'), '{"max_position_embeddings":2}');
  await writeFile(join(dir, 'tokenizer.json'), tokenizerJSON);
  const firstError = new Error('loader-first');
  let first = 0, alternate = 0;
  const options = { directory: pathToFileURL(dir + '/'), manifestPath: pathToFileURL(join(dir, 'manifest.json')), loadModel: async () => { first++; await new Promise(resolve => setImmediate(resolve)); throw firstError; } };
  const adapter = api.transformersAdapterBuilder();
  const a = adapter.warmup(options), b = adapter.warmup({ loadModel: async () => { alternate++; } });
  assert.equal(a, b);
  for (const pending of [a, b]) await assert.rejects(pending, error => error === firstError);
  assert.equal(adapter.warmup({}), a);
  await assert.rejects(adapter.infer('Ada'), error => error === firstError);
  let rules = 0;
  const analysis = api.analysisServiceBuilder({ modelDetectionService: modelDetectionServiceBuilder({ infer: adapter.infer }), ruleDetectionService: () => { rules++; return new Set(['PERSON']); } });
  await assert.rejects(analysis([{ fieldId: 'a', text: 'Ada', allowedCategories: [] }]), error => error === firstError);
  assert.equal(rules, 0);
  assert.equal(first, 1); assert.equal(alternate, 0);
  const otherError = new Error('loader-independent');
  const independent = api.transformersAdapterBuilder();
  await assert.rejects(independent.warmup({ ...options, loadModel: async () => { alternate++; throw otherError; } }), error => error === otherError);
  assert.equal(first, 1); assert.equal(alternate, 1);
});

test('successful adapters share only their own promise, hash every artifact before loader and use real tokenizer pipeline and Tensor at config limit', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rizzo-C-success-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const require = createRequire(new URL('../../poc-rizzo/package.json', import.meta.url));
  const { Tensor, env } = await import(new URL('transformers.node.mjs', pathToFileURL(require.resolve('@huggingface/transformers'))));
  const config = { max_position_embeddings: 2, id2label: { 0: 'O', 1: 'B-FULLNAME' } };
  const files = { 'config.json': JSON.stringify(config), 'tokenizer.json': tokenizerJSON, 'model.onnx': 'synthetic, never an ONNX session' };
  const manifest = { files: {} };
  for (const [name, bytes] of Object.entries(files)) { await writeFile(join(dir, name), bytes); manifest.files[name] = createHash('sha256').update(bytes).digest('hex'); }
  await writeFile(join(dir, 'manifest.json'), JSON.stringify(manifest));
  let loads = 0, alternate = 0; const inputs = [];
  const options = { directory: pathToFileURL(dir + '/'), manifestPath: pathToFileURL(join(dir, 'manifest.json')), loadModel: async (path, options) => {
    loads++; assert.equal(path, dir + '/'); assert.equal(env.allowRemoteModels, false);
    assert.deepEqual(options, { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true });
    // All original hashes must have been consumed before this loader can tamper them.
    await writeFile(join(dir, 'model.onnx'), 'post-hash synthetic mutation');
    await new Promise(resolve => setImmediate(resolve));
    return Object.assign(async input => { const ids = Array.from(input.input_ids.data, Number); inputs.push(ids); return { logits: new Tensor('float32', Float32Array.from(ids.flatMap(() => [0, 10])), [1, ids.length, 2]) }; }, { config });
  } };
  const adapter = api.transformersAdapterBuilder();
  const first = adapter.warmup(options), same = adapter.warmup({ loadModel: async () => { alternate++; } });
  assert.equal(first, same); const infer = await first; assert.equal(await same, infer);
  const model = modelDetectionServiceBuilder({ infer });
  assert.deepEqual([...await model('Ada Ada')], ['PERSON']);
  await assert.rejects(model('Ada Ada Ada'), /TOKEN_LIMIT/);
  assert.deepEqual(inputs, [[1, 1]]); assert.equal(loads, 1); assert.equal(alternate, 0);
  assert.equal(adapter.warmup(), first);
  // A separate instance cannot reuse a successful predecessor's cache or skip its hashes.
  const independent = api.transformersAdapterBuilder();
  await assert.rejects(independent.warmup(options), /MODEL_INTEGRITY_FAILURE/);
  assert.equal(loads, 1);
  await writeFile(join(dir, 'model.onnx'), files['model.onnx']);
  const another = api.transformersAdapterBuilder();
  const distinct = await another.warmup(options); assert.notEqual(distinct, infer); assert.equal(loads, 2);
});

test('all compiled imports including transitive services adapter and CLI avoid SDK loading model IO fetch and socket creation', async t => {
  const { pkg, cwd } = await sandbox(t);
  const paths = (await readdir(join(pkg, 'dist'), { recursive: true })).filter(p => p.endsWith('.js')).sort().map(p => pathToFileURL(join(pkg, 'dist', p)).href);
  const code = `
    import assert from 'node:assert/strict';
    import fs from 'node:fs'; import promises from 'node:fs/promises';
    import http from 'node:http'; import https from 'node:https'; import net from 'node:net';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';
    const calls = [];
    registerHooks({ resolve(specifier, context, next) { if (/huggingface|onnxruntime/.test(specifier)) { calls.push('SDK resolve'); throw Error('FORBIDDEN_SDK_RESOLUTION'); } return next(specifier, context); }, load(url, context, next) { if (/transformers\\.(?:node\\.)?mjs|onnxruntime/.test(url)) { calls.push('SDK load'); throw Error('FORBIDDEN_SDK_LOAD'); } return next(url, context); } });
    for (const owner of [fs, promises]) for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'stat', 'statSync', 'access', 'createReadStream']) if (typeof owner[name] === 'function') { const original = owner[name]; owner[name] = function(path, ...args) { if (/models\\/|model-manifest/.test(String(path))) { calls.push('model IO'); throw Error('FORBIDDEN_MODEL_IO'); } return original.call(this, path, ...args); }; }
    for (const owner of [http, https]) { owner.createServer = () => { calls.push('server'); throw Error('FORBIDDEN_SERVER'); }; owner.request = () => { calls.push('request'); throw Error('FORBIDDEN_REQUEST'); }; }
    net.Socket.prototype.connect = () => { calls.push('socket'); throw Error('FORBIDDEN_SOCKET'); };
    net.Server.prototype.listen = () => { calls.push('listen'); throw Error('FORBIDDEN_LISTEN'); };
    globalThis.fetch = () => { calls.push('fetch'); throw Error('FORBIDDEN_FETCH'); }; syncBuiltinESMExports();
    for (const path of ${JSON.stringify(paths)}) await import(path);
    const { transformersAdapterBuilder } = await import(${JSON.stringify(pathToFileURL(join(pkg, 'dist/adapters/transformersAdapter.js')).href)});
    const one = transformersAdapterBuilder(), two = transformersAdapterBuilder(); assert.notEqual(one, two);
    assert.deepEqual(calls, []); console.log('TRANSITIVE_IMPORT_SAFE');
  `;
  const result = child(code, cwd); assert.equal(result.status, 0, result.stderr + result.stdout); assert.equal(result.stdout, 'TRANSITIVE_IMPORT_SAFE\n');
});

