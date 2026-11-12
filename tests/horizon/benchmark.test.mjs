import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
import { evaluate } from '../bench/horizon/benchmark.mjs';
import { analyzeFields } from '../../poc-horizon/dist/analysis/analyze-fields.mjs';
import { fiscalCodeCandidates } from '../../poc-horizon/dist/recognizers/fiscal-code.mjs';
import { categoriesOf } from '../../poc-horizon/src/categories.mjs';

const sample = (text, expectedEntities) => ({ fieldId: 'description', split: 'evaluation',
  text, allowedCategories: [], expectedEntities });

test('internal analysis retains rule/model origin and original offsets without raw words', async () => {
  const text = 'RSSMRA85M01H501Q';
  const [analysis] = await analyzeFields([{ fieldId: 'description', text,
    allowedCategories: ['IT_FISCAL_CODE'] }], {
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

test('HTTP contract expects the common business email label', async () => {
  const { expectedEmailEntityType } = await import('../bench/horizon/contract-http.mjs');
  assert.equal(expectedEmailEntityType('presidio'), 'EMAIL_ADDRESS');
  assert.equal(expectedEmailEntityType('horizon'), 'EMAIL_ADDRESS');
  assert.throws(() => expectedEmailEntityType('other'), /Unknown engine/);
});

test('HTTP smoke checks uniform business output through injected HTTP and Docker', async () => {
  const { check } = await import('../bench/horizon/contract-http.mjs');
  for (const [engine, label] of [['presidio','EMAIL_ADDRESS'], ['horizon','EMAIL_ADDRESS'], ['rizzo','EMAIL_ADDRESS']]) {
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
        ? { findings:[], verdict:'accepted' }
        : typeof body === 'string' && body.includes('mario.rossi@example.com')
          ? { findings:[{ fieldId:'description', category:label }], verdict:'rejected' }
          : { code:'invalid_request' };
      return { status:response.code ? 400 : 200, text:async () => JSON.stringify(response) };
    };
    const result = await check('test-image', engine, { docker:fakeDocker, fetch:fakeFetch });
    assert.deepEqual(result, { image:'test-image', checks:6, status:'pass' });
    assert.deepEqual(dockerCalls.map(x=>x[0]), ['run','port','rm']);
  }
});

test('HTTP smoke does not turn model false positives or false negatives into quality gates', async () => {
  const { check } = await import('../bench/horizon/contract-http.mjs');
  const docker = command => command === 'port' ? '127.0.0.1:49152' : 'fixture-id';
  const fetch = async (url, options) => {
    if (url.endsWith('/health/ready')) return { status: 200, json: async () => ({ status: 'ready' }) };
    const body = options.body;
    const valid = typeof body === 'string' && (body.includes('Servizio digitale.') || body.includes('mario.rossi@example.com'));
    const payload = valid ? body.includes('Servizio digitale.')
      ? { verdict: 'rejected', findings: [{ fieldId: 'description', category: 'PERSON' }] }
      : { verdict: 'accepted', findings: [] }
      : { code: 'invalid_request' };
    return { status: valid ? 200 : 400, text: async () => JSON.stringify(payload) };
  };
  assert.deepEqual(await check('fixture', 'horizon', { docker, fetch }),
    { image: 'fixture', checks: 6, status: 'pass' });
});

test('memory fixture generation remains within the migrated 50-word HTTP contract', async () => {
  const { synthetic } = await import('../bench/horizon/container-memory.mjs');
  for (const index of [0, 255, 256, 500, 768, 999]) {
    const text = synthetic(index, 1000);
    assert.ok(text.split(/\p{White_Space}+/u).filter(Boolean).length <= 50);
    assert.ok(text.includes(`zop${index.toString(36)}q0v`));
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
    sample('private text', ['EMAIL'])], 0.35,
    async () => { invoked = true; return []; },
    { prepare: text => { invoked = true; return { text }; } }),
  /Unsupported expected entity label: EMAIL/);
  assert.equal(invoked, false);
});

test('benchmark maps native Horizon EMAIL to business EMAIL_ADDRESS before scoring', async () => {
  const result = await evaluate([sample('mario.rossi@example.com', ['EMAIL_ADDRESS'])], 0.35,
    async () => [{ entity_group: 'EMAIL', score: 0.9 }],
    { prepare: text => ({ text }) });
  assert.equal(result.byCategory.EMAIL_ADDRESS.tp, 1);
  assert.equal(result.detector.tp, 1);
  assert.equal(result.policy.tp, 1);
  assert.equal(result.unsupportedExpected, 0);
});

test('benchmark corpus uses business EMAIL_ADDRESS and scores an injected native finding', async () => {
  const corpus = JSON.parse(await readFile(new URL('../bench/horizon/corpus.json', import.meta.url)));
  const email = corpus.find(x => x.text.includes('mario.rossi@example.com'));
  assert.deepEqual(email.expectedEntities, ['EMAIL_ADDRESS']);
  const result = await evaluate([email], 0.35,
    async () => [{ entity_group: 'EMAIL', score: 0.9 }],
    { prepare: text => ({ text }) });
  assert.equal(result.byCategory.EMAIL_ADDRESS.tp, 1);
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
    allowedCategories: [] }], adapter, fiscalCodeCandidates, categoriesOf, 0.35);
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
