import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('importing app, services, adapter, composition root and CLIs neither loads SDK nor opens sockets', () => {
  const urls = ['app', 'services/analysisService', 'services/ruleDetectionService',
    'services/modelDetectionService', 'adapters/transformersAdapter', 'index', 'scripts/smoke', 'scripts/prefetch']
    .map(path => new URL('../../poc-horizon/dist/' + path + '.js', import.meta.url).href);
  const code = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    import net from 'node:net';
    let effects = 0;
    net.Server.prototype.listen = () => { effects++; throw Error('forbidden listen'); };
    globalThis.fetch = () => { effects++; throw Error('forbidden fetch'); };
    registerHooks({ resolve(specifier, context, next) {
      assert.notEqual(specifier, '@huggingface/transformers', 'imports must not load the SDK');
      return next(specifier, context);
    } });
    for (const url of ${JSON.stringify(urls)}) await import(url);
    assert.equal(effects, 0);
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

// Isolated synthetic SDK boundary: never load weights, tokenizer assets or ONNX sessions.
function probe(body) {
  const target = new URL('../../poc-horizon/dist/adapters/transformersAdapter.js', import.meta.url);
  const sdk = `export const env = {}; export function pipeline(...args) { return globalThis.probe.factory(...args); }`;
  const code = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const env = {};
    const calls = [];
    globalThis.probe = { factory: (...args) => factory(...args) };
    const sdkUrl = ${JSON.stringify('data:text/javascript,' + encodeURIComponent(sdk))};
    registerHooks({ resolve(s, c, next) {
      if (s === '@huggingface/transformers') return { url: sdkUrl, shortCircuit: true };
      return next(s, c);
    } });
    let factory;
    const { transformersAdapterBuilder: builder } = await import(${JSON.stringify(target.href)});
    const make = () => builder({ loadRuntime: async () => ({ env, pipeline: (...args) => factory(...args) }) });
    ${body}
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test('adapter owns a lazy promise per instance and import has no SDK configuration side effects', () => probe(`
  const sdk = await import(sdkUrl);
  assert.deepEqual(sdk.env, {}, 'import must not configure SDK');
  let initialized = 0, inferred = 0, tokenized = 0;
  factory = async (...args) => {
    initialized++; calls.push(args);
    const pipeline = async (text, options) => { inferred++; return { raw: text, options }; };
    pipeline.tokenizer = (text, options) => { tokenized++; return { input_ids: { size: 1 } }; };
    return pipeline;
  };
  const a = make(), b = make();
  assert.equal(initialized, 0);
  await Promise.all([a.ready(), a.ready(), a.prepare('original'), a.infer({ text: 'original' })]);
  assert.equal(initialized, 1, 'concurrent operations share one init');
  assert.equal(inferred, 1); assert.equal(tokenized, 1);
  await b.ready();
  assert.equal(initialized, 2, 'separate adapter instances must not share mutable state');
`));

test('adapter retries once after a shared initialization failure', () => probe(`
  let initialized = 0, release;
  const failure = new Error('synthetic init failure');
  const gate = new Promise(resolve => release = resolve);
  factory = async () => {
    initialized++;
    if (initialized === 1) { await gate; throw failure; }
    const pipeline = async () => [];
    pipeline.tokenizer = () => ({ input_ids: { size: 1 } });
    return pipeline;
  };
  const adapter = make();
  const operations = [adapter.ready(), adapter.prepare('a'), adapter.infer({ text: 'b' })];
  release();
  const failures = await Promise.allSettled(operations);
  assert.equal(initialized, 1);
  assert.ok(failures.every(result => result.status === 'rejected' && result.reason === failure));
  await Promise.all([adapter.ready(), adapter.prepare('a'), adapter.infer({ text: 'b' })]);
  assert.equal(initialized, 2);
`));

test('a failed injected runtime load is shared and retried without caching failure', () => probe(`
  let loaded = 0;
  const failure = new Error('synthetic loader failure');
  factory = async () => { const pipeline = async () => []; pipeline.tokenizer = () => ({ input_ids: { size: 1 } }); return pipeline; };
  const adapter = builder({ loadRuntime: async () => {
    loaded++;
    if (loaded === 1) throw failure;
    return { env, pipeline: factory };
  } });
  const first = await Promise.allSettled([adapter.ready(), adapter.prepare('a'), adapter.infer({ text: 'a' })]);
  assert.equal(loaded, 1);
  assert.ok(first.every(result => result.status === 'rejected' && result.reason === failure));
  await Promise.all([adapter.ready(), adapter.prepare('a')]);
  assert.equal(loaded, 2);
`));

test('real adapter uses exact offline/native options, budget 512/513, no inference during ready/preflight and opaque raw output', () => probe(`
  let inferred = 0;
  const raw = { deliberately: 'not an array' };
  factory = async (...args) => {
    calls.push(args);
    const pipeline = async (...args) => { inferred++; calls.push(args); return raw; };
    pipeline.tokenizer = (text, options) => {
      calls.push(['tokenize', text, options]);
      return { input_ids: { size: text === '513' ? 513 : 512 } };
    };
    return pipeline;
  };
  const adapter = make();
  await adapter.ready();
  assert.equal(inferred, 0);
  assert.deepEqual(await adapter.prepare('512'), { text: '512' });
  await assert.rejects(adapter.prepare('513'), { message: 'TOKEN_BUDGET_EXCEEDED' });
  assert.equal(inferred, 0);
  const original = ' 🙂e\\u0301 ';
  assert.equal(await adapter.infer({ text: original }), raw);
  assert.equal(inferred, 1);
  assert.deepEqual(calls, [
    ['token-classification', 'Horizon-Labs/pii-redactor-base', { dtype: 'q8', device: 'cpu', local_files_only: true }],
    ['tokenize', '512', { truncation: false, padding: false }],
    ['tokenize', '513', { truncation: false, padding: false }],
    [original, { aggregation_strategy: 'simple' }],
  ]);
  assert.equal(env.allowRemoteModels, false);
  assert.equal(env.allowLocalModels, true);
  assert.equal(env.useBrowserCache, false);
  assert.ok(env.localModelPath.endsWith('/poc-horizon/models/'));
`));
