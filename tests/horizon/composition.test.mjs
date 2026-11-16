import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";

test("linear composition root warms up, registers lifecycle handlers, then listens", () => {
  const indexUrl = new URL("../../poc-horizon/dist/index.js", import.meta.url)
    .href;
  const detector = `
    export async function transformersAdapterBuilder(options) {
      globalThis.probe.events.push(['warmup', options]);
      await new Promise(resolve => setImmediate(resolve));
      globalThis.probe.events.push('warmed');
      return { ready: () => true, prepare() { throw Error('unexpected'); }, infer() { throw Error('unexpected'); } };
    }
  `;
  const infrastructure = `
    export async function startServer(handler, config, lifecycle) {
      if (typeof handler !== 'function') throw Error('missing RequestListener');
      if (typeof lifecycle.onError !== 'function' || typeof lifecycle.onShutdownComplete !== 'function' || typeof lifecycle.onShutdownTimeout !== 'function') throw Error('missing lifecycle');
      globalThis.probe.events.push(['startServer', config]);
    }
  `;
  const code = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    globalThis.probe = { events: [] };
    process.env.ANALYZER_PORT = '0';
    process.env.ANALYZER_BIND_HOST = '127.0.0.1';
    process.env.ANALYZER_TOKEN_BUDGET = '8';
    const indexUrl = ${JSON.stringify(indexUrl)};
    registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL === indexUrl && specifier === './adapters/transformersAdapter.js')
        return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(detector))}, shortCircuit: true };
      if (context.parentURL === indexUrl && specifier === '@pagopa/detector-http')
        return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(infrastructure))}, shortCircuit: true };
      return next(specifier, context);
    } });
    await import(indexUrl);
    assert.deepEqual(probe.events, [
      ['warmup', { tokenBudget: 8 }], 'warmed',
      ['startServer', { port: 0, host: '127.0.0.1', requestTimeout: 10000 }]
    ]);
    console.log('composition verified');
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", code],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /composition verified/);
});

test("warmup failure is redacted and never creates a server", () => {
  const indexUrl = new URL("../../poc-horizon/dist/index.js", import.meta.url)
    .href;
  const detector = `export async function transformersAdapterBuilder() { throw Error('SENSITIVE_SENTINEL'); }`;
  const code = `
    import { registerHooks } from 'node:module';
    const indexUrl = ${JSON.stringify(indexUrl)};
    registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL === indexUrl && specifier === './adapters/transformersAdapter.js')
        return { url: ${JSON.stringify("data:text/javascript," + encodeURIComponent(detector))}, shortCircuit: true };
      if (context.parentURL === indexUrl && specifier === '@pagopa/detector-http')
        return { url: 'data:text/javascript,export function startServer(){throw Error("MUST_NOT_START")}', shortCircuit: true };
      return next(specifier, context);
    } });
    await import(indexUrl);
  `;
  const result = spawnSync(
    process.execPath,
    ["--input-type=module", "--eval", code],
    {
      encoding: "utf8",
      timeout: 10_000,
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stderr, "detector_unavailable\n");
  assert.doesNotMatch(result.stderr, /SENSITIVE|MUST_NOT_START/);
});
