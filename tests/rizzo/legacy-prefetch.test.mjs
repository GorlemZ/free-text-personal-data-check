import test from 'node:test';
import { cliCases, cliCase, assertCliCase } from './support/legacy-startup.mjs';

for (const scenario of cliCases) test('M1 prefetch preserves legacy CLI behavior: ' + scenario.name, async t => {
  assertCliCase(await cliCase(t, scenario), scenario);
});
