import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
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

test('HTTP contract expects each engine’s native email label', async () => {
  const { expectedEmailEntityType } = await import('../bench/contract-http.mjs');
  assert.equal(expectedEmailEntityType('spacy'), 'EMAIL_ADDRESS');
  assert.equal(expectedEmailEntityType('horizon'), 'EMAIL');
  assert.throws(() => expectedEmailEntityType('other'), /Unknown engine/);
});

test('HTTP smoke checks native email labels through injected HTTP and Docker', async () => {
  const { check } = await import('../bench/contract-http.mjs');
  for (const [engine, label] of [['spacy','EMAIL_ADDRESS'], ['horizon','EMAIL']]) {
    const dockerCalls = [];
    const fakeDocker = (...args) => {
      dockerCalls.push(args);
      if (args[0] === 'run') return 'container-id';
      if (args[0] === 'port') return '127.0.0.1:49152';
      if (args[0] === 'rm') return '';
      throw new Error('Unexpected Docker command');
    };
    const fakeFetch = async (url, options) => {
      if (url.endsWith('/health/ready')) return { status:200,
        json:async () => ({ status:'ready' }) };
      assert.equal(url, 'http://127.0.0.1:49152/v1/analyze');
      const body = options.body;
      const response = typeof body === 'string' && body.includes('Servizio digitale.')
        ? { findings:[], modelPolicyVersion:'test', verdict:'accepted' }
        : typeof body === 'string' && body.includes('mario.rossi@example.com')
          ? { findings:[{ entityType:label }], modelPolicyVersion:'test', verdict:'rejected' }
          : { code:'INVALID_ANALYZE_REQUEST' };
      return { status:response.code ? 400 : 200, text:async () => JSON.stringify(response) };
    };
    const result = await check('test-image', engine, { docker:fakeDocker, fetch:fakeFetch });
    assert.deepEqual(result, { image:'test-image', checks:6, status:'pass' });
    assert.deepEqual(dockerCalls.map(x=>x[0]), ['run','port','rm']);
  }
});

test('benchmark stub evaluation uses its injected preflight without loading the model', async () => {
  const result = await evaluate([sample('RSSMRA85M01H501Q', ['IT_FISCAL_CODE'])], 0.35,
    async () => [], { prepare: text => ({ text }) });
  assert.equal(result.technicalErrors, 0);
  assert.equal(result.byCategory.IT_FISCAL_CODE.tp, 1);
});

test('benchmark rejects unsupported expected labels before running inference or scoring', async () => {
  let invoked = false;
  await assert.rejects(evaluate([sample('neutral text', []),
    sample('private text', ['EMAIL_ADDRESS'])], 0.35,
    async () => { invoked = true; return []; },
    { prepare: text => { invoked = true; return { text }; } }),
  /Unsupported expected entity label: EMAIL_ADDRESS/);
  assert.equal(invoked, false);
});

test('benchmark scores the native Horizon EMAIL finding as a true positive', async () => {
  const result = await evaluate([sample('mario.rossi@example.com', ['EMAIL'])], 0.35,
    async () => [{ entity_group: 'EMAIL', score: 0.9 }],
    { prepare: text => ({ text }) });
  assert.equal(result.byCategory.EMAIL.tp, 1);
  assert.equal(result.detector.tp, 1);
  assert.equal(result.policy.tp, 1);
  assert.equal(result.unsupportedExpected, 0);
});

test('legacy benchmark corpus uses native EMAIL and scores it with an injected finding', async () => {
  const corpus = JSON.parse(await readFile(new URL('../bench/corpus.json', import.meta.url)));
  const email = corpus.find(x => x.text.includes('mario.rossi@example.com'));
  assert.deepEqual(email.expectedEntities, ['EMAIL']);
  const result = await evaluate([email], 0.35,
    async () => [{ entity_group: 'EMAIL', score: 0.9 }],
    { prepare: text => ({ text }) });
  assert.equal(result.byCategory.EMAIL.tp, 1);
  assert.equal(result.policy.tp, 1);
  assert.equal(result.unsupportedExpected, 0);
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
