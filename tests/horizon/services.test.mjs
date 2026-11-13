import { test } from 'node:test';
import assert from 'node:assert/strict';

async function services(options = {}) {
  const root = new URL('../../poc-horizon/dist/', import.meta.url);
  const path = new URL('services/analysisService.js', root);
  const module = await import(path);
  assert.equal(typeof module.analysisServiceBuilder, 'function', 'analysis must expose separated raw-service coordination');
  const { ruleDetectionServiceBuilder } = await import(new URL('services/ruleDetectionService.js', root));
  const { modelDetectionServiceBuilder } = await import(new URL('services/modelDetectionService.js', root));
  const events = [];
  const rules = ruleDetectionServiceBuilder(options.recognize ?? (text => { events.push('collect:' + text); return []; }));
  const model = modelDetectionServiceBuilder({
    ready: async () => { events.push('ready'); },
    prepare: options.prepare ?? (async text => { events.push('prepare:' + text); return { text }; }),
    infer: options.infer ?? (async ({ text }) => { events.push('infer:' + text); return []; }),
  });
  const ruleDetectionService = { ...rules, interpret(raw, text) { events.push('interpret-rule:' + text); return rules.interpret(raw, text); } };
  const modelDetectionService = { ...model, interpret(raw, text) { events.push('interpret-model:' + text); return model.interpret(raw, text); } };
  return { rules, model, events, analysis: module.analysisServiceBuilder({ ruleDetectionService, modelDetectionService }) };
}
const fields = ['one', 'two'].map(text => ({ fieldId: text, text, allowedCategories: [] }));

test('real adapter and three builders stop all work when the last field exceeds the token budget', async () => {
  const { transformersAdapterBuilder } = await import('../../poc-horizon/dist/adapters/transformersAdapter.js');
  const { analysisServiceBuilder } = await import('../../poc-horizon/dist/services/analysisService.js');
  const { ruleDetectionServiceBuilder } = await import('../../poc-horizon/dist/services/ruleDetectionService.js');
  const { modelDetectionServiceBuilder } = await import('../../poc-horizon/dist/services/modelDetectionService.js');
  const calls = [];
  const pipeline = async () => { calls.push('infer'); return []; };
  pipeline.tokenizer = text => { calls.push('tokenize:' + text); return { input_ids: { size: Number(text) } }; };
  const adapter = transformersAdapterBuilder({ loadRuntime: async () => ({ env: {},
    pipeline: async () => { calls.push('init'); return pipeline; } }) });
  const modelDetectionService = modelDetectionServiceBuilder(adapter);
  const ruleDetectionService = ruleDetectionServiceBuilder(() => { calls.push('collect'); return []; });
  const analysis = analysisServiceBuilder({ ruleDetectionService, modelDetectionService });
  await assert.rejects(analysis.analyze(['512', '513'].map(text => ({ fieldId: text, text, allowedCategories: [] }))),
    { message: 'TOKEN_BUDGET_EXCEEDED' });
  assert.deepEqual(calls, ['init', 'tokenize:512', 'tokenize:513']);
  await modelDetectionService.ready();
  assert.deepEqual(calls, ['init', 'tokenize:512', 'tokenize:513'], 'preflight error must not invalidate an initialized pipeline');
});

test('three real builders preserve global sequential preflight then per-field collect/infer/interpret/policy', async () => {
  const { analysis, events } = await services();
  const result = await analysis.analyze(fields);
  assert.deepEqual(events, ['prepare:one', 'prepare:two',
    'collect:one', 'infer:one', 'interpret-rule:one', 'interpret-model:one',
    'collect:two', 'infer:two', 'interpret-rule:two', 'interpret-model:two']);
  assert.deepEqual(result, fields.map(({ fieldId }) => ({ fieldId,
    detected: new Set(), possible: new Set(), denied: new Set(), candidates: [] })));
});

test('global preflight awaits each field, and final prepare failure prevents every rule and inference', async () => {
  let release;
  const gate = new Promise(resolve => release = resolve);
  const events = [];
  const { analysis } = await services({
    prepare: async text => { events.push('prepare:' + text); if (text === 'one') await gate; else throw Error('budget'); return { text }; },
    recognize: () => { events.push('collect'); return []; }, infer: async () => { events.push('infer'); return []; },
  });
  const run = analysis.analyze(fields);
  await new Promise(resolve => setImmediate(resolve));
  assert.deepEqual(events, ['prepare:one']);
  release();
  await assert.rejects(run, /budget/);
  assert.deepEqual(events, ['prepare:one', 'prepare:two']);
});

test('rule collect is opaque; malformed containers/candidates fail only after raw inference', async () => {
  for (const raw of [null, {}, [null], [[]], [{ source: 'invalid' }],
    [{ source: 'rule', category: 'UNKNOWN', check: 'passed', start: 0, end: 1 }]]) {
    const events = [];
    const { rules, analysis } = await services({ recognize: () => { events.push('collect'); return raw; },
      infer: async () => { events.push('infer'); return []; } });
    assert.equal(rules.collect('one'), raw);
    events.length = 0;
    await assert.rejects(analysis.analyze([fields[0]]));
    assert.deepEqual(events, ['collect', 'infer']);
  }
});

test('recognizer throw prevents infer; infer throw and non-array model prevent rule interpretation', async () => {
  const calls = [];
  const { analysis } = await services({ recognize: () => { calls.push('collect'); throw Error('recognizer'); },
    infer: async () => { calls.push('infer'); return []; } });
  await assert.rejects(analysis.analyze([fields[0]]), /recognizer/);
  assert.deepEqual(calls, ['collect']);
  for (const throws of [true, false]) {
    const raw = [{ get source() { throw Error('must not interpret rules'); } }];
    const { analysis, events } = await services({ recognize: () => raw,
      infer: async () => { if (throws) throw Error('infer failed'); return {}; } });
    await assert.rejects(analysis.analyze([fields[0]]), throws ? /infer failed/ : /INVALID_RESULTS/);
    assert.deepEqual(events, ['prepare:one']);
  }
});

test('model service delegates opaque raw infer/prepare/readiness, then interprets with unchanged threshold and failed/invalid candidate semantics', async () => {
  const raw = [{ entity_group: 'PERSON', score: 0.34 },
    { entity_group: 'CREDIT_CARD', score: 0.9, start: 0, end: 3 },
    { entity_group: 'LOCATION', score: 0.99 }];
  const { model, analysis, events } = await services({
    recognize: () => [{ source: 'rule', category: 'PERSON', check: 'failed', start: 0, end: 3 }],
    infer: async () => raw,
  });
  await model.ready();
  assert.equal(await model.infer({ text: 'one' }), raw);
  assert.deepEqual(events, ['ready']);
  const [result] = await analysis.analyze([fields[0]]);
  assert.deepEqual([...result.possible], ['PERSON']);
  assert.deepEqual([...result.detected], []);
  assert.equal(result.candidates.length, 3);
  assert.equal(result.candidates[0].check, 'failed');
  assert.deepEqual(result.candidates[1], { source: 'model', category: 'PERSON', score: 0.34 });
  const [allowed] = await (await services({ recognize: () => [],
    infer: async () => [{ entity_group: 'PERSON', score: 0.35 }] })).analysis.analyze([{ ...fields[0], allowedCategories: ['PERSON'] }]);
  assert.deepEqual([...allowed.detected], ['PERSON']);
  assert.deepEqual([...allowed.denied], []);
});
