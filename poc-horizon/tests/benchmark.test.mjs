import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from '../bench/benchmark.mjs';
import { analyzeFields } from '../dist/analysis/analyze-fields.mjs';
import { fiscalCodeCandidates } from '../dist/recognizers/fiscal-code.mjs';
import { categoriesOf } from '../src/categories.mjs';

const sample = (text, expectedEntities) => ({ fieldId: 'description', split: 'evaluation',
  text, allowedEntityTypes: [], expectedEntities });

test('internal analysis retains rule/model origin and original offsets without raw words', async () => {
  const text = 'RSSMRA85M01H501Q';
  const [analysis] = await analyzeFields([{ fieldId: 'description', text,
    allowedEntityTypes: ['IT_FISCAL_CODE'] }], {
    prepare: value => ({ text: value }),
    infer: async () => [{ entity_group: 'PERSON', score: 0.9,
      start: 0, end: 16, word: 'DO_NOT_EXPOSE' }],
  }, fiscalCodeCandidates, categoriesOf, 0.35);
  assert.deepEqual(analysis.candidates, [
    { source: 'rule', category: 'IT_FISCAL_CODE', start: 0, end: 16, check: 'passed' },
    { source: 'model', category: 'PERSON', start: 0, end: 16, score: 0.9 },
  ]);
  assert.deepEqual([...analysis.denied], ['PERSON']);
  assert.ok(!JSON.stringify(analysis).includes('DO_NOT_EXPOSE'));
});

test('benchmark stub evaluation uses its injected preflight without loading the model', async () => {
  const result = await evaluate([sample('RSSMRA85M01H501Q', ['IT_FISCAL_CODE'])], 0.35,
    async () => [], { prepare: text => ({ text }) });
  assert.equal(result.technicalErrors, 0);
  assert.equal(result.byCategory.IT_FISCAL_CODE.tp, 1);
});

test('benchmark counts the local fiscal-code recognizer as part of Horizon detection', async () => {
  const result = await evaluate([sample('RSSMRA85M01H501Q', ['IT_FISCAL_CODE'])],
    0.35, async () => [], { prepare: text => ({ text }) });
  assert.ok(result.commonCategories.includes('IT_FISCAL_CODE'));
  assert.equal(result.byCategory.IT_FISCAL_CODE.tp, 1);
  assert.equal(result.unsupportedExpected, 0);
  assert.equal(result.falseNegativeDiagnosis.noCandidate, 0);
});

test('the benchmark and HTTP orchestrator use the same CF and native union', async () => {
  const text = 'RSSMRA85M01H501Q';
  const adapter = { prepare: value => ({ text: value }), infer: async () => [] };
  const [analysis] = await analyzeFields([{ fieldId: 'description', text,
    allowedEntityTypes: [] }], adapter, fiscalCodeCandidates, categoriesOf, 0.35);
  const result = await evaluate([sample(text, ['IT_FISCAL_CODE'])], 0.35,
    async () => [], { prepare: value => ({ text: value }) });
  assert.deepEqual([...analysis.detected], ['IT_FISCAL_CODE']);
  assert.equal(result.byCategory.IT_FISCAL_CODE.tp, 1);
});

test('benchmark preflights before rules and inference and still calls model on a rule match', async () => {
  const events = [];
  const text = 'RSSMRA85M01H501Q';
  const result = await evaluate([sample(text, ['IT_FISCAL_CODE'])], 0.35,
    async ({ text }) => { events.push('model'); return []; }, {
      prepare: value => { events.push('prepare'); return { text: value }; },
      recognize: value => { events.push('rules'); return fiscalCodeCandidates(value); },
    });
  assert.deepEqual(events, ['prepare', 'rules', 'model']);
  assert.equal(result.byCategory.IT_FISCAL_CODE.tp, 1);
});

test('a native TAX_ID never becomes an Italian fiscal code in the benchmark', async () => {
  const result = await evaluate([sample('Nessun identificativo.', [])], 0.35,
    async () => [{ entity_group: 'TAX_ID', score: 0.9 }],
    { prepare: text => ({ text }) });
  assert.equal(result.byCategory.IT_FISCAL_CODE.fp, 0);
  assert.equal(result.policy.fp, 0);
});

test('benchmark excludes checksum failures from findings', async () => {
  const invalid = 'RSSMRA85M01H501R';
  const result = await evaluate([sample(invalid, [])], 0.35, async () => [],
    { prepare: text => ({ text }) });
  assert.equal(result.technicalErrors, 0);
  assert.equal(result.byCategory.IT_FISCAL_CODE.fp, 0);
  assert.equal(result.policy.fp, 0);
});
