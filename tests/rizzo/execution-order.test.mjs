import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCategories } from '../../poc-rizzo/dist/services/analysisService.js';
import { modelDetectionServiceBuilder } from '../../poc-rizzo/dist/services/modelDetectionService.js';

test('model inference and mapping precede supplementary rules; errors never permit fallback', async () => {
  const trace = [];
  const rules = () => { trace.push('rules'); return new Set(['IT_IDENTITY_CARD']); };
  const run = output => detectCategories('synthetic', modelDetectionServiceBuilder({ infer: async () => { trace.push('infer'); return { output }; } }), rules);
  assert.deepEqual([...await run([{ get entity_group() { trace.push('map'); return 'FULLNAME'; }, score: .5 }])], ['PERSON', 'IT_IDENTITY_CARD']);
  assert.deepEqual(trace, ['infer', 'map', 'rules']);
  for (const output of [null, [{ entity_group: 'UNKNOWN', score: .1 }]]) {
    trace.length = 0;
    await assert.rejects(run(output));
    assert.deepEqual(trace, ['infer']);
  }
  trace.length = 0;
  const marker = Error('synthetic failure');
  await assert.rejects(detectCategories('synthetic', async () => { throw marker; }, rules), error => error === marker);
  assert.deepEqual(trace, []);
});
