import test from 'node:test';
import { manifestCases, modelCase, assertModelCase } from './support/legacy-startup.mjs';

for (const scenario of manifestCases) test('M1 manifest preserves legacy JS coercion and failures: ' + scenario.name, async t => {
  assertModelCase(await modelCase(t, scenario), scenario);
});
