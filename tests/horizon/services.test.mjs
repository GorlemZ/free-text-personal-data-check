import test from 'node:test';
import assert from 'node:assert/strict';
import { analysisServiceBuilder } from '../../poc-horizon/dist/services/analysisService.js';
import { transformersAdapterBuilder } from '../../poc-horizon/dist/adapters/transformersAdapter.js';

const fields = ['one', 'two'].map(text => ({ fieldId: text, text, allowedCategories: [] }));
const adapter = overrides => ({ ready: async () => true, prepare: text => ({ text }), infer: async () => [], ...overrides });

test('real adapter budgets each field before its inference and aborts on overflow', async () => {
  const calls = [];
  const pipeline = async () => { calls.push('infer'); return []; };
  pipeline.tokenizer = text => { calls.push('tokenize:' + text); return { input_ids: { size: Number(text) } }; };
  const model = await transformersAdapterBuilder({ loadRuntime: async () => ({ env: {},
    pipeline: async () => { calls.push('init'); return pipeline; } }) });
  const analysis = analysisServiceBuilder({ adapter: model, recognize: () => { calls.push('rules'); return new Set(); } });
  await assert.rejects(analysis.analyze(['512', '513'].map(text => ({ fieldId: text, text, allowedCategories: [] }))),
    { message: 'TOKEN_BUDGET_EXCEEDED' });
  await model.ready();
  assert.deepEqual(calls, ['init', 'tokenize:512', 'infer', 'rules', 'tokenize:513']);
});

test('budget inference mapping rules and policy complete before next field', async () => {
  const events = [];
  const analysis = analysisServiceBuilder({ adapter: adapter({
    prepare: async text => { events.push('prepare:' + text); return { text }; },
    infer: async ({ text }) => { events.push('infer:' + text); return [{ get entity_group() { events.push('map:' + text); return 'PERSON'; }, score: .35 }]; },
  }), recognize: text => { events.push('rules:' + text); return new Set(); } });
  const results = await analysis.analyze(fields);
  assert.deepEqual(events, ['prepare:one', 'infer:one', 'map:one', 'rules:one', 'prepare:two', 'infer:two', 'map:two', 'rules:two']);
  assert.deepEqual(results, fields.map(({ fieldId }) => ({ fieldId, detected: new Set(['PERSON']), denied: new Set(['PERSON']) })));
});

test('pending budget blocks that field; later overflow aborts without partial result', async () => {
  const gate = Promise.withResolvers(), calls = [];
  const analysis = analysisServiceBuilder({ adapter: adapter({
    prepare: async text => { calls.push(text); if (text === 'one') await gate.promise; else throw Error('budget'); return { text }; },
    infer: async () => { calls.push('infer'); return []; },
  }), recognize: () => { calls.push('rules'); return new Set(); } });
  const result = analysis.analyze(fields);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(calls, ['one']); gate.resolve();
  await assert.rejects(result, /budget/);
  assert.deepEqual(calls, ['one', 'infer', 'rules', 'two']);
});

test('model errors preserve identity and never execute supplementary rules', async () => {
  const marker = Error('synthetic failure');
  const analysis = analysisServiceBuilder({ adapter: adapter({ infer: async () => { throw marker; } }),
    recognize: () => { assert.fail('no fallback'); } });
  await assert.rejects(analysis.analyze(fields), error => error === marker);
});

test('invalid supplementary output is technical failure, never a partial model result', async () => {
  for (const raw of [null, {}, [null], [[]], [{ source: 'invalid' }],
    new Set(['UNKNOWN']), new Set([null]), new Set(['PERSON', {}])]) {
    const calls = [];
    const analysis = analysisServiceBuilder({ adapter: adapter({ infer: async () => { calls.push('infer'); return [{ entity_group: 'PERSON', score: 1 }]; } }),
      recognize: () => { calls.push('rules'); return raw; } });
    await assert.rejects(analysis.analyze(fields));
    assert.deepEqual(calls, ['infer', 'rules']);
  }
});

test('injected rules for covered categories cannot fill model omissions', async () => {
  const analysis = analysisServiceBuilder({ adapter: adapter({}), recognize: () => new Set(['PERSON']) });
  assert.deepEqual((await analysis.analyze(fields)).map(({ detected }) => [...detected]), [[], []]);
});
