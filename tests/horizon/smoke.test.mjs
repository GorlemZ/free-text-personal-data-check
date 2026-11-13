import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { createHandler } from './create-test-app.mjs';

for (const cli of [false, true]) {
  test(`smoke CLI composes one real service stack only behind main guard: ${cli ? 'CLI' : 'import'}`, () => {
    const smokeUrl = new URL('../../poc-horizon/dist/scripts/smoke.js', import.meta.url).href;
    const adapter = `export function transformersAdapterBuilder() {
      probe.instances++;
      return {
        ready: async () => { probe.ready++; },
        prepare(text) {
          probe.prepared++;
          if (text === 'x '.repeat(1000) || text.startsWith('x-'.repeat(600))) throw Error('TOKEN_BUDGET_EXCEEDED');
          return { text };
        },
        infer: async () => { probe.inferred++; return []; },
      };
    }`;
    const code = `
      import assert from 'node:assert/strict';
      import { fileURLToPath } from 'node:url';
      import { registerHooks } from 'node:module';
      globalThis.probe = { instances: 0, ready: 0, prepared: 0, inferred: 0 };
      const logs = [];
      const print = console.log;
      console.log = value => logs.push(JSON.parse(value));
      const fetch = globalThis.fetch;
      globalThis.fetch = (url, options) => {
        assert.equal(new URL(url).hostname, '127.0.0.1', 'only synthetic local HTTP is permitted');
        return fetch(url, options);
      };
      registerHooks({ resolve(specifier, context, next) {
        if (context.parentURL === ${JSON.stringify(smokeUrl)} && specifier === '../adapters/transformersAdapter.js')
          return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(adapter))}, shortCircuit: true };
        assert.notEqual(specifier, '@huggingface/transformers', 'no SDK/model in mocked CLI smoke');
        return next(specifier, context);
      } });
      if (${cli}) process.argv[1] = fileURLToPath(${JSON.stringify(smokeUrl)});
      await import(${JSON.stringify(smokeUrl)});
      assert.deepEqual(probe, ${cli ? '{ instances: 1, ready: 0, prepared: 5, inferred: 3 }' : '{ instances: 0, ready: 0, prepared: 0, inferred: 0 }'});
      if (${cli}) {
        assert.equal(logs.length, 1);
        assert.equal(logs[0].tokenLimitRejected, true);
        assert.equal(logs[0].fiscalCodeDetected, true);
        assert.equal(logs[0].fiscalCodeFailClosed, true);
      } else assert.deepEqual(logs, []);
      print('mock smoke composition verified');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], { encoding: 'utf8', timeout: 10000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, result.stderr + result.stdout);
  });
}

test('smoke exercises migrated HTTP and token failure without making model quality a gate', async () => {
  const source = await readFile(new URL('../../poc-horizon/dist/scripts/smoke.js', import.meta.url), 'utf8');
  // Do not import a historical eager entrypoint: it would load real model weights.
  assert.ok(source.includes('export async function smoke('), 'smoke must support injected inference');
  const { smoke } = await import('../../poc-horizon/dist/scripts/smoke.js');
  const texts = [];
  const result = await smoke({
    detectText: async text => {
      if (text === 'x '.repeat(1000)) throw Error('TOKEN_BUDGET_EXCEEDED');
      return []; // A genuine FN must be measurable, not an infrastructure failure.
    },
    handler: createHandler({ ready: async () => true,
      prepare: text => {
        texts.push(text);
        if (text.startsWith('x-'.repeat(600))) throw Error('TOKEN_BUDGET_EXCEEDED');
        return { text };
      }, infer: async () => [] }),
  });
  assert.equal(result.tailEmailDetected, false);
  assert.equal(result.tokenLimitRejected, true);
  assert.equal(result.fiscalCodeDetected, true);
  assert.equal(result.fiscalCodeFailClosed, true);
  assert.equal(texts.length, 2);
  assert.ok(texts.every(text => text.split(/\p{White_Space}+/u).filter(Boolean).length <= 50));
});
