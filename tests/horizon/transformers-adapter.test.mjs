import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("production adapters use static SDK imports without running pipeline at module import", async () => {
  for (const file of [
    new URL(
      "../../poc-horizon/src/adapters/transformersAdapter.ts",
      import.meta.url,
    ),
    new URL(
      "../../poc-rizzo/src/adapters/transformersAdapter.ts",
      import.meta.url,
    ),
  ]) {
    const source = await import("node:fs/promises").then(({ readFile }) =>
      readFile(file, "utf8"),
    );
    assert.match(source, /from ["']@huggingface\/transformers["']/);
    assert.doesNotMatch(
      source,
      /await import\(["']@huggingface\/transformers["']\)/,
    );
  }
});

test("importing app, services, adapter, composition root and CLIs opens no sockets", () => {
  const urls = [
    "app",
    "services/analysisService",
    "services/ruleDetectionService",
    "adapters/transformersAdapter",

    "scripts/smoke",
    "scripts/prefetch",
  ].map(
    (path) =>
      new URL("../../poc-horizon/dist/" + path + ".js", import.meta.url).href,
  );
  const code = `
    import assert from 'node:assert/strict';
    import net from 'node:net';
    let effects = 0;
    net.Server.prototype.listen = () => { effects++; throw Error('forbidden listen'); };
    globalThis.fetch = () => { effects++; throw Error('forbidden fetch'); };
    for (const url of ${JSON.stringify(urls)}) await import(url);
    assert.equal(effects, 0);
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", code],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
});

// Isolated synthetic SDK boundary: never load weights, tokenizer assets or ONNX sessions.
function probe(body) {
  const target = new URL(
    "../../poc-horizon/dist/adapters/transformersAdapter.js",
    import.meta.url,
  );
  const sdk = `export const env = globalThis.probe.env; export function pipeline(...args) { return globalThis.probe.factory(...args); }`;
  const code = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    const env = {};
    const calls = [];
    globalThis.probe = { env, factory: (...args) => factory(...args) };
    const sdkUrl = ${JSON.stringify("data:text/javascript," + encodeURIComponent(sdk))};
    registerHooks({ resolve(s, c, next) {
      if (s === '@huggingface/transformers') return { url: sdkUrl, shortCircuit: true };
      return next(s, c);
    } });
    let factory;
    const { transformersAdapterBuilder: builder } = await import(${JSON.stringify(target.href)});
    const make = () => builder();
    ${body}
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", code],
    { encoding: "utf8", timeout: 10000 },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
}

test("explicit initialization returns a ready adapter and never reloads on requests", () =>
  probe(`
  let loaded = 0;
  factory = async () => { loaded++; const p = async () => []; p.tokenizer = () => ({ input_ids: { size: 1 } }); return p; };
  const adapter = await make();
  assert.equal(loaded, 1);
  await adapter.ready(); await adapter.prepare('a'); await adapter.infer({ text: 'a' });
  assert.equal(loaded, 1);
`));

test("initialization failure rejects the builder without an implicit retry", () =>
  probe(`
  let loaded = 0;
  const failure = Error('synthetic');
  factory = async () => { loaded++; throw failure; };
  await assert.rejects(make(), error => error === failure);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(loaded, 1);
`));

test("real adapter uses exact offline/native options, budget 512/513, no inference during ready/preflight and opaque raw output", () =>
  probe(`
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
  const adapter = await make();
  await adapter.ready();
  assert.equal(inferred, 0);
  assert.deepEqual(await adapter.prepare('512'), { text: '512' });
  await assert.rejects(adapter.prepare('513'), { message: 'TOKEN_BUDGET_EXCEEDED' });
  assert.equal(inferred, 0);
  const original = ' 🙂e\\u0301 ';
  assert.equal(await adapter.infer({ text: original }), raw);
  assert.equal(inferred, 1);
  assert.deepEqual(calls, [
    ['token-classification', 'Horizon-Labs/pii-redactor-base', {
      dtype: 'q8',
      device: 'cpu',
      local_files_only: true,
      session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    }],
    ['tokenize', '512', { truncation: false, padding: false, add_special_tokens: true }],
    ['tokenize', '513', { truncation: false, padding: false, add_special_tokens: true }],
    [original, { aggregation_strategy: 'simple' }],
  ]);
  assert.equal(env.allowRemoteModels, false);
  assert.equal(env.allowLocalModels, true);
  assert.equal(env.useBrowserCache, false);
  assert.ok(env.localModelPath.endsWith('/poc-horizon/models/'));
`));
