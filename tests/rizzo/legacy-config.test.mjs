import test from 'node:test';
import { configCases, modelCase, assertModelCase } from './support/legacy-startup.mjs';

for (const scenario of configCases) test('M1 config preserves legacy errors and call order: ' + scenario.name, async t => {
  assertModelCase(await modelCase(t, scenario), scenario);
});
