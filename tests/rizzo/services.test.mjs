import test from 'node:test';
import assert from 'node:assert/strict';
import * as api from '../../poc-rizzo/dist/index.js';
import { rawInferenceBuilder } from '../../poc-rizzo/dist/adapters/transformersAdapter.js';
import { modelDetectionServiceBuilder } from '../../poc-rizzo/dist/services/modelDetectionService.js';
import { interpretSemanticEntities } from '../../poc-rizzo/dist/model/modelInterpretation.js';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../../poc-rizzo/dist/app.js';

const field = (fieldId, text, allowedCategories = []) => ({ fieldId, text, allowedCategories });
test('service builders compose raw interpretation, real rules and field policy sequentially', async () => {
  assert.equal(typeof api.analysisServiceBuilder, 'function', 'SERVICE_BUILDERS_REQUIRED');
  const { modelDetectionServiceBuilder } = await import('../../poc-rizzo/dist/services/modelDetectionService.js');
  const { ruleDetectionServiceBuilder } = await import('../../poc-rizzo/dist/services/ruleDetectionService.js');
  const trace = [];
  const modelDetectionService = modelDetectionServiceBuilder({ infer: async text => {
    trace.push(text);
    return { output: [{ entity_group: 'FULLNAME', word: 'synthetic', score: .5 }] };
  } });
  const analysis = api.analysisServiceBuilder({ modelDetectionService, ruleDetectionService: ruleDetectionServiceBuilder() });
  assert.deepEqual(await analysis([field('b', 'synthetic@example.test'), field('a', 'other', ['PERSON'])]), [
    { fieldId: 'b', category: 'PERSON' }, { fieldId: 'b', category: 'EMAIL_ADDRESS' },
  ]);
  assert.deepEqual(trace, ['synthetic@example.test', 'other']);
});

function composed(trace, { output, preflight, pipeline } = {}) {
  const infer = rawInferenceBuilder({ maxTokens: 1, tokenizer: (text, options) => {
    trace.push('tokenize:' + text); assert.deepEqual(options, { truncation: false, padding: false });
    return preflight ? preflight(text) : { input_ids: { data: [1] } };
  }, pipeline: async (text, options) => {
    trace.push('pipeline:' + text); assert.deepEqual(options, { aggregation_strategy: 'simple' });
    if (pipeline) return pipeline(text);
    if (output) return output(text);
    return [observed(trace, text + ':0'), observed(trace, text + ':1', 'CITY', .1)];
  } });
  const modelDetectionService = modelDetectionServiceBuilder({ infer });
  return api.analysisServiceBuilder({ modelDetectionService, ruleDetectionService: text => {
    trace.push('rules:' + text); return new Set(['EMAIL_ADDRESS']);
  } });
}
function observed(trace, id, label = 'FULLNAME', score = .5) {
  return Object.defineProperties({}, Object.fromEntries([
    ['entity_group', label], ['word', 'synthetic'], ['score', score],
  ].map(([key, value]) => [key, { get() { trace.push('project:' + id + ':' + key); return value; } }])));
}

test('each field finishes preflight pipeline complete projection interpretation rules fusion and policy before the next', async () => {
  const trace = [], analysis = composed(trace);
  const a = field('a', 'first'), b = field('b', 'second', ['PERSON']);
  assert.deepEqual(await analysis([a, b]), [{ fieldId: 'a', category: 'PERSON' }, { fieldId: 'a', category: 'EMAIL_ADDRESS' }, { fieldId: 'b', category: 'EMAIL_ADDRESS' }]);
  assert.deepEqual(trace, ['first', 'second'].flatMap(text => ['tokenize:' + text, 'pipeline:' + text,
    ...[0, 1].flatMap(i => ['entity_group', 'word', 'score'].map(key => 'project:' + text + ':' + i + ':' + key)), 'rules:' + text]));
});

test('all native projection getters run before invalid first-entity interpretation and thrown identity wins', async () => {
  const trace = [], marker = new Error('PROJECTION_SENTINEL');
  const first = observed(trace, 'first', 'UNKNOWN', .1);
  const second = Object.defineProperty({}, 'entity_group', { get() { trace.push('second:get'); throw marker; } });
  const analysis = composed(trace, { output: () => [first, second] });
  await assert.rejects(analysis([field('a', 'x')]), error => error === marker);
  assert.deepEqual(trace, ['tokenize:x', 'pipeline:x', 'project:first:entity_group', 'project:first:word', 'project:first:score', 'second:get']);
});

test('array guard precedes native accessors and rules; every malformed low-score or ignored native item is still validated', async () => {
  const invalid = new Proxy({}, { get(target, key) { if (key === 'then') return undefined; throw Error('GUARD_MUST_PRECEDE_ACCESS'); } });
  for (const output of [invalid, null, [null], [{ entity_group: 'CITY', word: 42, score: .1 }], [{ entity_group: 'CITY', word: 'x', score: NaN }], [{ entity_group: 'UNKNOWN', word: 'x', score: .1 }],
    [{ entity_group: 'FULLNAME', word: 'x', score: .5 }, { entity_group: 'CITY', word: 'x', score: -1 }]]) {
    const trace = [], analysis = composed(trace, { output: () => output });
    await assert.rejects(analysis([field('a', 'x')]), { message: 'INVALID_MODEL_OUTPUT' });
    assert.deepEqual(trace, ['tokenize:x', 'pipeline:x']);
  }
});

for (const mode of ['token-limit', 'tokenizer', 'pipeline', 'projection']) test('second-field ' + mode + ' preserves error identity and never runs its rules or yields partial HTTP findings', async t => {
  const trace = [], marker = new Error('SENSITIVE_SENTINEL');
  const analysis = composed(trace, {
    preflight: text => { if (text === 'second' && mode === 'tokenizer') throw marker; return { input_ids: { data: text === 'second' && mode === 'token-limit' ? [1, 2] : [1] } }; },
    pipeline: text => {
      if (text === 'second' && mode === 'pipeline') throw marker;
      if (text === 'second' && mode === 'projection') return [Object.defineProperty({}, 'entity_group', { get() { throw marker; } })];
      return [{ entity_group: 'FULLNAME', word: 'x', score: .5 }];
    },
  });
  const fields = [field('a', 'first'), field('b', 'second')];
  await assert.rejects(analysis(fields), error => mode === 'token-limit' ? error.message === 'TOKEN_LIMIT' : error === marker);
  const expected = ['tokenize:first', 'pipeline:first', 'rules:first', 'tokenize:second', ...(['pipeline', 'projection'].includes(mode) ? ['pipeline:second'] : [])];
  assert.deepEqual(trace, expected);
  trace.length = 0;
  const server = http.createServer(createApp({ ready: () => true, analysisService: analysis }));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const response = await fetch('http://127.0.0.1:' + server.address().port + '/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
  assert.equal(response.status, 503); assert.deepEqual(await response.json(), { code: 'detector_unavailable' });
  assert.deepEqual(trace, expected);
});

test('allowlists never skip inference or rescue model failures, including a fully allowed field', async () => {
  const trace = [], marker = new Error('MODEL_SENTINEL');
  const analysis = composed(trace, { pipeline: () => { throw marker; } });
  const { CATEGORIES } = await import('../../poc-rizzo/dist/model/categories.js');
  await assert.rejects(analysis([field('a', 'x', CATEGORIES)]), error => error === marker);
  assert.deepEqual(trace, ['tokenize:x', 'pipeline:x']);
});

test('semantic legacy boundary retains primitive boxing and the precise repeated getter access order', () => {
  for (const value of [undefined, null, false, true, 0, 1, 'x', Symbol('x'), 1n]) assert.throws(() => interpretSemanticEntities([value]), /INVALID_MODEL_OUTPUT/);
  const trace = [];
  const value = Object.defineProperties({}, Object.fromEntries([['label', 'FULLNAME'], ['text', 'x'], ['score', .5]].map(([key, result]) => [key, { get() { trace.push(key); return result; } }])));
  assert.deepEqual([...interpretSemanticEntities([value])], ['PERSON']);
  assert.deepEqual(trace, ['label', 'text', 'score', 'score', 'score', 'score', 'text', 'label', 'label']);
});

