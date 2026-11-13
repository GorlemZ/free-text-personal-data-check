import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { modelDetectionServiceBuilder } from '../../../poc-rizzo/dist/services/modelDetectionService.js';
import { analysisServiceBuilder } from '../../../poc-rizzo/dist/services/analysisService.js';
import { createApp } from '../../../poc-rizzo/dist/app.js';

// Opaque production port: this probe never opens, clones or pre-validates its raw result.
export async function boundaryCases(makePort) {
  const rows = [];
  for (const shape of ['array', 'non-array']) for (const mode of ['undefined', 'throws-second', 'throws-first']) {
    const trace = [], marker = new Error('NATIVE_THEN_SENTINEL');
    const successful = shape === 'array' && mode !== 'throws-first';
    let reads = 0;
    function output() {
      reads = 0;
      const result = shape === 'array' ? [{ entity_group: 'FULLNAME', word: 'synthetic', score: .5 }] : {};
      Object.defineProperty(result, 'then', { get() {
        trace.push('then:' + ++reads);
        if (mode === 'throws-first' || (mode === 'throws-second' && reads === 2)) throw marker;
        return undefined;
      } });
      return result;
    }
    const port = await makePort({ tokenizer: () => ({ input_ids: { data: [1] } }), pipeline: async () => output(), maxTokens: 1 });
    const model = modelDetectionServiceBuilder({ infer: port });
    const analysis = analysisServiceBuilder({ modelDetectionService: model, ruleDetectionService: () => { trace.push('rules'); return new Set(); } });
    const fields = [{ fieldId: 'x', text: 'synthetic', allowedCategories: [] }];
    if (successful) assert.deepEqual(await analysis(fields), [{ fieldId: 'x', category: 'PERSON' }]);
    else await assert.rejects(analysis(fields), error => mode === 'throws-first' ? error === marker : error.message === 'INVALID_MODEL_OUTPUT');
    assert.deepEqual(trace, successful ? ['then:1', 'rules'] : ['then:1'], 'C1-M1: one mandatory then lookup, guard before extra reads/rules');
    trace.length = 0;
    const server = http.createServer(createApp({ ready: () => true, analysisService: analysis }));
    server.listen(0, '127.0.0.1'); await once(server, 'listening');
    try {
      const response = await fetch('http://127.0.0.1:' + server.address().port + '/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields }) });
      assert.equal(response.status, successful ? 200 : 503);
      assert.deepEqual(await response.json(), successful ? { verdict: 'rejected', findings: [{ fieldId: 'x', category: 'PERSON' }] } : { code: 'detector_unavailable' });
      assert.deepEqual(trace, successful ? ['then:1', 'rules'] : ['then:1']);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    rows.push({ shape, mode, status: successful ? 200 : 503, trace: [...trace] });
  }
  for (const failure of ['tokenizer', 'token-limit', 'producer', 'projection']) {
    const marker = new Error('PORT_FAILURE_SENTINEL'), trace = [];
    const port = await makePort({ maxTokens: 1, tokenizer() {
      trace.push('tokenizer'); if (failure === 'tokenizer') throw marker;
      return { input_ids: { data: failure === 'token-limit' ? [1, 2] : [1] } };
    }, pipeline: async () => {
      trace.push('pipeline'); if (failure === 'producer') throw marker;
      return [Object.defineProperty({}, 'entity_group', { get() { trace.push('projection'); throw marker; } })];
    } });
    if (failure === 'tokenizer' || failure === 'token-limit') {
      let pending; assert.doesNotThrow(() => { pending = port('synthetic'); }, 'preflight failure must remain asynchronous');
      await assert.rejects(pending, error => failure === 'tokenizer' ? error === marker : error.message === 'TOKEN_LIMIT');
      assert.deepEqual(trace, ['tokenizer']); trace.length = 0;
    }
    const analysis = analysisServiceBuilder({ modelDetectionService: modelDetectionServiceBuilder({ infer: port }), ruleDetectionService: () => { trace.push('rules'); return new Set(); } });
    await assert.rejects(analysis([{ fieldId: 'x', text: 'synthetic', allowedCategories: [] }]), error => failure === 'token-limit' ? error.message === 'TOKEN_LIMIT' : error === marker);
    assert.deepEqual(trace, ['tokenizer', ...(['producer', 'projection'].includes(failure) ? ['pipeline'] : []), ...(failure === 'projection' ? ['projection'] : [])]);
    rows.push({ failure, identityPreserved: true, trace });
  }
  return rows;
}
