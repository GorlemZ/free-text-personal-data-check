import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { rawInferenceBuilder } from '../../poc-rizzo/dist/adapters/transformersAdapter.js';
import { boundaryCases } from './support/async-boundary.mjs';

test('C1-M1 raw builder to model service preserves one native then lookup, guards, identities and HTTP', async () => {
  const rows = await boundaryCases(async options => rawInferenceBuilder(options));
  assert.equal(rows.length, 10);
});
test('C1-M1 warmed real adapter port preserves one native then lookup with real asset hashes and HTTP', () => {
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./support/async-adapter-worker.mjs', import.meta.url))], { env: process.env, encoding: 'utf8', timeout: 30000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  const report = JSON.parse(result.stdout); assert.equal(report.rows.length, 10); assert.equal(report.hashNegativeControl, true);
});
