import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../bench/benchmark.mjs';

const sample = (text, expectedEntities) => ({ fieldId: 'description', split: 'evaluation',
  text, allowedEntityTypes: [], expectedEntities });

test('benchmark counts the local fiscal-code recognizer as part of Horizon detection', async () => {
  const result = await evaluate([sample('ZZZQQQ99A01X000Z', ['IT_FISCAL_CODE'])],
    0.35, async () => []);
  assert.ok(result.commonCategories.includes('IT_FISCAL_CODE'));
  assert.equal(result.byCategory.IT_FISCAL_CODE.tp, 1);
  assert.equal(result.unsupportedExpected, 0);
  assert.equal(result.falseNegativeDiagnosis.noCandidate, 0);
});

test('a native TAX_ID never becomes an Italian fiscal code in the benchmark', async () => {
  const result = await evaluate([sample('Nessun identificativo.', [])], 0.35,
    async () => [{ entity_group: 'TAX_ID', score: 0.9 }]);
  assert.equal(result.byCategory.IT_FISCAL_CODE.fp, 0);
});
