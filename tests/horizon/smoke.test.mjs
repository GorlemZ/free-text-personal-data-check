import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHandler } from '../../poc-horizon/src/server.mjs';

test('smoke exercises migrated HTTP and token failure without making model quality a gate', async () => {
  const source = await readFile(new URL('../../poc-horizon/scripts/smoke.mjs', import.meta.url), 'utf8');
  // Do not import a historical eager entrypoint: it would load real model weights.
  assert.ok(source.includes('export async function smoke('), 'smoke must support injected inference');
  const { smoke } = await import('../../poc-horizon/scripts/smoke.mjs');
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
