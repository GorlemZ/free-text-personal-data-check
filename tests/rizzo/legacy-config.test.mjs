import test from 'node:test';
import { configCases, modelCase, assertModelCase } from './support/legacy-startup.mjs';

for (const scenario of configCases) test('startup validates model limits and preserves filesystem errors: ' + scenario.name, async t => {
  assertModelCase(await modelCase(t, scenario), scenario);
});
