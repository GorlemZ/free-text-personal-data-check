import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { interpretSemanticEntities } from '../../poc-rizzo/dist/model/modelInterpretation.js';
import { rawInferenceBuilder } from '../../poc-rizzo/dist/adapters/transformersAdapter.js';
import { modelDetectionServiceBuilder } from '../../poc-rizzo/dist/services/modelDetectionService.js';
import { analysisServiceBuilder } from '../../poc-rizzo/dist/services/analysisService.js';
import { createApp } from '../../poc-rizzo/dist/app.js';

const keysFor = phase => phase === 'native' ? ['entity_group', 'word', 'score'] : ['label', 'text', 'score'];
const semanticOrder = ['label', 'text', 'score', 'score', 'score', 'score', 'text', 'label', 'label'];
const nativeModel = output => modelDetectionServiceBuilder({ infer: rawInferenceBuilder({ maxTokens: 1, tokenizer: () => ({ input_ids: { data: [1] } }), pipeline: async () => output }) });
async function withAccessors(value, phase, trace, run, thrown) {
  const proto = Object.getPrototypeOf(value), keys = keysFor(phase), saved = keys.map(key => Object.getOwnPropertyDescriptor(proto, key));
  try {
    keys.forEach((key, index) => Object.defineProperty(proto, key, { configurable: true, get() {
      trace.push([key, typeof this]);
      if (thrown && index === 1) throw thrown;
      return index === 0 ? 'FULLNAME' : index === 1 ? (typeof this === typeof value ? 'synthetic' : '') : .5;
    } }));
    return await run();
  } finally { keys.forEach((key, index) => { if (saved[index]) Object.defineProperty(proto, key, saved[index]); else delete proto[key]; }); }
}
for (const phase of ['native', 'semantic']) for (const value of ['x', 1, true, 1n, Symbol('synthetic')]) {
  test('C1-M2 ' + phase + ' preserves strict inherited getter receiver: ' + typeof value, async () => {
    const trace = [];
    await withAccessors(value, phase, trace, async () => {
      const categories = phase === 'native' ? await nativeModel([value])('synthetic') : interpretSemanticEntities([value]);
      assert.deepEqual([...categories], ['PERSON'], 'C1-M2: primitive receiver must not become an object wrapper');
      assert.deepEqual(trace, (phase === 'native' ? keysFor(phase) : semanticOrder).map(key => [key, typeof value]));
    });
  });
}
for (const phase of ['native', 'semantic']) test('C1-M2 ' + phase + ' primitive receiver remains rejected PERSON through real HTTP', async () => {
  const trace = [];
  await withAccessors('x', phase, trace, async () => {
    const analysis = analysisServiceBuilder({ modelDetectionService: phase === 'native' ? nativeModel(['x']) : async () => interpretSemanticEntities(['x']), ruleDetectionService: () => new Set() });
    const server = http.createServer(createApp({ ready: () => true, analysisService: analysis }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: [{ fieldId: 'x', text: 'synthetic' }] }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { verdict: 'rejected', findings: [{ fieldId: 'x', category: 'PERSON' }] });
      assert.deepEqual(trace, (phase === 'native' ? keysFor(phase) : semanticOrder).map(key => [key, 'string']));
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  });
});

test('C1-M2 preserves false zero nullish short circuits, optional projection, proxies and accessor error identity', async () => {
  for (const value of [false, 0, '', 0n]) for (const phase of ['semantic', 'native']) {
    const trace = [];
    await withAccessors(value, phase, trace, async () => {
      if (phase === 'semantic') { assert.throws(() => interpretSemanticEntities([value]), /INVALID_MODEL_OUTPUT/); assert.deepEqual(trace, []); }
      else { assert.deepEqual([...await nativeModel([value])('x')], ['PERSON']); assert.deepEqual(trace, keysFor(phase).map(key => [key, typeof value])); }
    });
  }
  for (const value of [null, undefined]) {
    assert.throws(() => interpretSemanticEntities([value]), /INVALID_MODEL_OUTPUT/);
    await assert.rejects(nativeModel([value])('x'), /INVALID_MODEL_OUTPUT/);
  }
  for (const phase of ['native', 'semantic']) {
    const marker = new Error('PRIMITIVE_GETTER_SENTINEL'), trace = [];
    await withAccessors(1, phase, trace, async () => {
      if (phase === 'native') await assert.rejects(nativeModel([1])('x'), error => error === marker);
      else assert.throws(() => interpretSemanticEntities([1]), error => error === marker);
      assert.deepEqual(trace, keysFor(phase).slice(0, 2).map(key => [key, 'number']));
    }, marker);
    const keys = keysFor(phase), accesses = []; let proxy;
    const target = Object.create(Object.defineProperties({}, Object.fromEntries(keys.map((key, index) => [key, { get() { assert.equal(this, proxy); return index === 0 ? 'FULLNAME' : index === 1 ? 'synthetic' : .5; } }]))));
    proxy = new Proxy(target, { get(target, key, receiver) { accesses.push(key); assert.equal(receiver, proxy); return Reflect.get(target, key, receiver); } });
    const result = phase === 'native' ? await nativeModel([proxy])('x') : interpretSemanticEntities([proxy]);
    assert.deepEqual([...result], ['PERSON']); assert.deepEqual(accesses, phase === 'native' ? keys : semanticOrder);
  }
});
