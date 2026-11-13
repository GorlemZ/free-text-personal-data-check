import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, child } from './support/sandbox.mjs';

test('compiled modules import safely and serve synthetic HTTP using standard resolution without source or models', async t => {
  const { pkg, cwd } = await sandbox(t);
  const url = name => pathToFileURL(join(pkg, 'dist', name + '.js')).href;
  const code = `
    import assert from 'node:assert/strict';
    import http from 'node:http';
    import { existsSync } from 'node:fs';
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => { throw Error('forbidden import fetch'); };
    const originalListen = http.Server.prototype.listen;
    http.Server.prototype.listen = () => { throw Error('forbidden import listen'); };
    const { createApp } = await import(${JSON.stringify(url('app'))});
    const { modelDetectionServiceBuilder } = await import(${JSON.stringify(url('services/modelDetectionService'))});
    const { ruleDetectionServiceBuilder } = await import(${JSON.stringify(url('services/ruleDetectionService'))});
    const { analysisServiceBuilder } = await import(${JSON.stringify(url('services/analysisService'))});
    await import(${JSON.stringify(url('adapters/transformersAdapter'))});
    await import(${JSON.stringify(url('index'))});
    const { prefetch } = await import(${JSON.stringify(url('scripts/prefetch'))});
    const { smoke } = await import(${JSON.stringify(url('scripts/smoke'))});
    assert.equal(typeof prefetch, 'function');
    assert.equal(typeof smoke, 'function');
    assert.equal(existsSync(${JSON.stringify(join(pkg, 'src'))}), false);
    assert.equal(existsSync(${JSON.stringify(join(pkg, 'models'))}), false);
    assert.equal(process.env.NODE_OPTIONS, undefined);
    assert.equal(process.env.NODE_PATH, undefined);
    http.Server.prototype.listen = originalListen;
    const trace = [];
    const modelDetectionService = modelDetectionServiceBuilder({ infer: async text => { trace.push(text); return { output: [{ entity_group: 'FULLNAME', word: 'synthetic', score: .9 }] }; } });
    const analysisService = analysisServiceBuilder({ modelDetectionService, ruleDetectionService: ruleDetectionServiceBuilder() });
    const server = http.createServer(createApp({ analysisService, ready: () => true }));
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      const base = 'http://127.0.0.1:' + server.address().port;
      const health = await realFetch(base + '/health/ready');
      assert.equal(health.status, 200);
      assert.deepEqual(trace, []);
      const response = await realFetch(base + '/v1/analyze', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ fields: [{ fieldId: 'fixture', text: 'synthetic@example.test' }] }) });
      assert.equal(response.status, 200);
      assert.deepEqual(await response.json(), { verdict: 'rejected', findings: [{ fieldId: 'fixture', category: 'EMAIL_ADDRESS' }, { fieldId: 'fixture', category: 'PERSON' }] });
      assert.deepEqual(trace, ['synthetic@example.test']);
    } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
    console.log('DIST_ONLY_STANDARD_RESOLUTION_PASS');
  `;
  const result = child(code, cwd);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /DIST_ONLY_STANDARD_RESOLUTION_PASS/);
});
