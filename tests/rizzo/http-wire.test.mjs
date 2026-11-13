import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createApp } from '../../poc-rizzo/dist/app.js';
import { analyzeFields } from './support/http.mjs';

async function fixture(t) {
  const trace = [];
  const server = http.createServer(createApp({ ready: () => { trace.push('ready'); return true; }, analysisService: fields => analyzeFields(fields, text => { trace.push('detect'); return new Set(); }) }));
  server.prependListener('request', request => { const resume = request.resume; request.resume = function(...args) { trace.push('resume'); return resume.apply(this, args); }; });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  return { server, trace };
}
function request(server, { method = 'POST', path = '/v1/analyze', body = Buffer.from('{"fields":[{"fieldId":"x","text":""}]}'), contentType = 'application/json' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, method, path, headers: { 'content-type': contentType, 'content-length': body.length } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks).toString() }));
    });
    req.on('error', reject); req.end(body);
  });
}

test('real HTTP wire keeps strict UTF8, BOM, duplicate keys, Unicode and byte limits with legacy framing', async t => {
  const { server, trace } = await fixture(t);
  const valid = '{"fields":[{"fieldId":"x","text":""}]}';
  const cases = [
    [Buffer.from(valid), 200, '{"verdict":"accepted","findings":[]}'],
    [Buffer.from('\ufeff' + valid), 400, '{"code":"invalid_request"}'],
    [Buffer.concat([Buffer.from('{"fields":[{"fieldId":"x","text":"'), Buffer.from([0xc0, 0xaf]), Buffer.from('"}]}')]), 400, '{"code":"invalid_request"}'],
    [Buffer.from('{"fields":[{"fieldId":"x","text":"","te\\u0078t":""}]}'), 400, '{"code":"invalid_request"}'],
    [Buffer.from('{"fields":[{"fieldId":"x","text":"\\ud800"}]}'), 400, '{"code":"invalid_request"}'],
    [Buffer.from(JSON.stringify({ fields: [{ fieldId: '😀', text: 'synthetic😀' }] })), 200, '{"verdict":"accepted","findings":[]}'],
    [Buffer.from(JSON.stringify({ fields: [{ fieldId: 'x', text: 'x'.repeat(1024 * 1024 - Buffer.byteLength(valid)) }] })), 200, '{"verdict":"accepted","findings":[]}'],
    [Buffer.from(JSON.stringify({ fields: [{ fieldId: 'x', text: 'x'.repeat(1024 * 1024 + 1 - Buffer.byteLength(valid)) }] })), 413, '{"code":"body_too_large"}'],
  ];
  for (const [body, status, expectedBody] of cases) {
    trace.length = 0;
    const actual = await request(server, { body });
    assert.equal(actual.status, status);
    assert.equal(actual.body, expectedBody);
    assert.equal(actual.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(actual.headers['content-length'], undefined);
    assert.equal(actual.headers['transfer-encoding'], 'chunked');
    if (status === 413) { assert.equal(actual.headers.connection, 'close'); assert.ok(trace.includes('resume')); }
    if (status === 200) assert.deepEqual(trace.filter(x => x !== 'resume'), ['ready', 'detect']);
    else assert.deepEqual(trace.filter(x => x !== 'resume'), []);
  }
});

test('real HTTP wire drains unsupported content types and retains exact route and header behavior', async t => {
  const { server, trace } = await fixture(t);
  const badContent = await request(server, { contentType: 'text/plain' });
  assert.equal(badContent.status, 400); assert.equal(badContent.body, '{"code":"invalid_request"}');
  assert.ok(trace.includes('resume')); assert.deepEqual(trace.filter(x => x !== 'resume'), []);
  for (const [method, path] of [['GET', '/v1/analyze'], ['POST', '/health/ready'], ['GET', '/health/ready?x'], ['POST', '/v1/analyze/'], ['POST', '/v1/analyze?x'], ['GET', '/missing']]) {
    trace.length = 0;
    const actual = await request(server, { method, path, body: Buffer.alloc(0) });
    assert.equal(actual.status, 404); assert.equal(actual.body, '{"code":"not_found"}');
    assert.equal(actual.headers['content-type'], 'application/json; charset=utf-8');
    assert.equal(actual.headers['content-length'], undefined);
    assert.equal(actual.headers['transfer-encoding'], 'chunked');
    assert.deepEqual(trace.filter(x => x !== 'resume'), []);
  }
  const accepted = await request(server, { contentType: ' APPLICATION/JSON ; charset=utf-8' });
  assert.equal(accepted.status, 200); assert.equal(accepted.body, '{"verdict":"accepted","findings":[]}');
});
