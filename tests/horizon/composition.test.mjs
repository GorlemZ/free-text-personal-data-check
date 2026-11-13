import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

for (const cli of [false, true]) {
  test(`composition root warms up before listen with exact config and main guard: ${cli ? 'CLI' : 'import'}`, () => {
    const indexUrl = new URL('../../poc-horizon/dist/index.js', import.meta.url).href;
    const detectorUrl = new URL('../../poc-horizon/dist/adapters/transformersAdapter.js', import.meta.url).href;
    const detector = `
      export function transformersAdapterBuilder() {
        globalThis.probe.instances++;
        return { ready, prepare, infer: inferPrepared };
      }
      async function ready() {
        globalThis.probe.events.push('warmup');
        globalThis.probe.started();
        if (globalThis.probe.fail) throw Error('SENTINELSECRET');
        await globalThis.probe.gate;
      }
      export function prepare() { throw Error('unexpected inference/preflight'); }
      export function inferPrepared() { throw Error('unexpected inference/preflight'); }
    `;
    const http = `
      export function createServer(handler) {
        if (typeof handler !== 'function') throw Error('missing real RequestListener');
        globalThis.probe.events.push('createServer');
        return {
          set requestTimeout(value) { globalThis.probe.events.push(['timeout', value]); },
          listen(port, host) { globalThis.probe.events.push(['listen', port, host]); },
        };
      }
    `;
    const code = `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      import { fileURLToPath } from 'node:url';
      let release, started;
      const warmupStarted = new Promise(resolve => started = resolve);
      globalThis.probe = { events: [], instances: 0, gate: new Promise(resolve => release = resolve), started, fail: false };
      process.env.ANALYZER_PORT = '0';
      process.env.ANALYZER_BIND_HOST = '127.0.0.1';
      const indexUrl = ${JSON.stringify(indexUrl)};
      registerHooks({ resolve(specifier, context, next) {
        if (context.parentURL === indexUrl && specifier === './adapters/transformersAdapter.js')
          return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(detector))}, shortCircuit: true };
        if (context.parentURL === indexUrl && specifier === 'node:http')
          return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(http))}, shortCircuit: true };
        assert.notEqual(specifier, '@huggingface/transformers', 'no real model SDK in startup probe');
        return next(specifier, context);
      } });
      if (${cli}) process.argv[1] = fileURLToPath(indexUrl);
      const imported = import(indexUrl);
      if (${cli}) {
        await warmupStarted;
        assert.deepEqual(probe.events, ['warmup']);
        release(); await imported;
      } else {
        const { main } = await imported;
        assert.deepEqual(probe.events, [], 'main guard must prevent startup on import');
        assert.equal(probe.instances, 0, 'import must not construct a model adapter');
        const started = main();
        assert.deepEqual(probe.events, ['warmup']);
        release(); await started;
      }
      assert.deepEqual(probe.events, ['warmup', 'createServer', ['timeout', 10000], ['listen', 0, '127.0.0.1']]);
      assert.equal(probe.instances, 1, 'one adapter per composition root execution');
      const { main } = await imported;
      probe.events.length = 0;
      delete process.env.ANALYZER_PORT;
      delete process.env.ANALYZER_BIND_HOST;
      await main();
      assert.deepEqual(probe.events, ['warmup', 'createServer', ['timeout', 10000], ['listen', 8000, '127.0.0.1']]);
      assert.equal(probe.instances, 2);
      probe.events.length = 0; probe.fail = true;
      const errors = [];
      console.error = (...args) => errors.push(args);
      await main();
      assert.deepEqual(probe.events, ['warmup'], 'failed warmup must not create server or listen');
      assert.equal(process.exitCode, 1);
      assert.deepEqual(errors, [['detector_unavailable']]);
      assert.equal(probe.instances, 3);
      process.exitCode = 0;
      console.log('composition verified');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
      encoding: 'utf8', timeout: 10000,
    });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /composition verified/);
  });
}
