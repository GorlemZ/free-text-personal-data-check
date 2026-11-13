import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, child } from './support/sandbox.mjs';

for (const mode of ['defaults', 'port-zero', 'warmup-failure']) {
  test('compiled entrypoint retains Rizzo startup behavior: ' + mode, async t => {
    const { pkg, cwd } = await sandbox(t);
    const indexURL = pathToFileURL(join(pkg, 'dist/index.js')).href;
    const app = `export function createApp() {
      globalThis.trace.push('create');
      return () => {};
    }`;
    const transport = `export function createServer() { return { on() {}, listen(port, host) { globalThis.trace.push(['listen', port, host]); }, close(done) { done(); } };
    }`;
    const detector = `export function transformersAdapterBuilder() { return { infer: async () => [], async warmup() {
      globalThis.trace.push('warmup');
      await new Promise(resolve => setImmediate(resolve));
      ${mode === 'warmup-failure' ? "throw Error('SENSITIVE_SENTINEL');" : "globalThis.trace.push('warmed'); return async () => new Set();"}
    } }; }`;
    const hook = `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      globalThis.trace = [];
      delete process.env.BIND_HOST;
      ${mode === 'port-zero' ? "process.env.PORT = '0';" : 'delete process.env.PORT;'}
      registerHooks({ resolve(specifier, context, next) {
        if (context.parentURL === ${JSON.stringify(indexURL)} && specifier === 'node:http') return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(transport))}, shortCircuit: true };
        if (context.parentURL === ${JSON.stringify(indexURL)} && specifier === './app.js') return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(app))}, shortCircuit: true };
        if (context.parentURL === ${JSON.stringify(indexURL)} && specifier === './adapters/transformersAdapter.js') return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(detector))}, shortCircuit: true };
        return next(specifier, context);
      } });
      process.on('exit', () => {
        assert.deepEqual(globalThis.trace, ${JSON.stringify(mode === 'warmup-failure' ? ['warmup'] : ['warmup', 'warmed', 'create', ['listen', mode === 'port-zero' ? 0 : 8000, '127.0.0.1']])});
      });
    `;
    const result = child('', cwd, ['--import', 'data:text/javascript,' + encodeURIComponent(hook), join(pkg, 'dist/index.js')]);
    assert.equal(result.status, mode === 'warmup-failure' ? 1 : 0, result.stderr + result.stdout);
    assert.equal(result.stdout, '');
    assert.equal(result.stderr, mode === 'warmup-failure' ? 'STARTUP_FAILED\n' : '');
  });
}
