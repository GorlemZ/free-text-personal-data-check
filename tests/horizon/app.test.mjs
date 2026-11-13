import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import { spawnSync } from 'node:child_process';
import { createApp } from '../../poc-horizon/dist/app.js';
import { InvalidRequest, BodyTooLarge } from '../../poc-horizon/dist/model/errors.js';
import { loadConfig, HTTP_LIMITS } from '../../poc-horizon/dist/config/config.js';

function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function within(promise) {
  let timer;
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(Error('deterministic barrier timeout')), 3000);
    })]);
  } finally { clearTimeout(timer); }
}
async function serve(t, deps) {
  const server = createServer(createApp(deps));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
  });
  return `http://127.0.0.1:${server.address().port}`;
}
const field = (fieldId = 'description', text = 'neutral') => ({ fieldId, text });
const post = (url, fields = [field()]) => fetch(url + '/v1/analyze', {
  method: 'POST', headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ fields }), signal: AbortSignal.timeout(5000),
});
async function responseIs(response, status, body) {
  assert.equal(response.status, status);
  assert.equal(response.headers.get('content-type'), 'application/json');
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.deepEqual(await response.json(), body);
}
const unavailable = { code: 'detector_unavailable' };
const accepted = { verdict: 'accepted', findings: [] };

test('FIFO holds four including active, rejects fifth, bypasses readiness, and recovers after rejection', { timeout: 12000 }, async t => {
  const gates = Array.from({ length: 5 }, deferred);
  const admissions = Array.from({ length: 5 }, deferred);
  const entered = Array.from({ length: 5 }, deferred);
  t.after(() => gates.forEach(g => g.resolve()));
  const counts = [], events = [];
  let active = 0, maximum = 0, calls = 0, healthy = true, readyCalls = 0;
  const url = await serve(t, {
    ready: () => { readyCalls++; if (!healthy) throw Error('SENTINELSECRET'); },
    onQueued: pending => { counts.push(pending); admissions[counts.length - 1].resolve(); },
    analysisService: { analyze: async fields => {
      const i = calls++;
      active++; maximum = Math.max(maximum, active);
      events.push(`analyze:${fields[0].fieldId}`);
      entered[i].resolve();
      try {
        await gates[i].promise;
        if (i === 0) throw Error('SENTINELSECRET');
        return [{ fieldId: fields[0].fieldId, get denied() {
          events.push(`project:${fields[0].fieldId}`); return new Set();
        } }];
      } finally { active--; }
    } },
  });
  const jobs = [];
  for (let i = 0; i < 4; i++) {
    jobs.push(post(url, [field(`job${i}`)]));
    await within(admissions[i].promise);
  }
  await within(entered[0].promise);
  assert.equal(calls, 1);
  assert.deepEqual(counts, [1, 2, 3, 4]);
  await responseIs(await post(url, [field('overflow')]), 503, unavailable);
  await responseIs(await fetch(url + '/health/ready'), 200, { status: 'ready' });
  healthy = false;
  await responseIs(await fetch(url + '/health/ready'), 503, unavailable);
  await responseIs(await fetch(url + '/v1/analyze', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: '{"fields":[]}' }), 400, { code: 'invalid_request' });
  assert.equal(calls, 1);
  assert.deepEqual(counts, [1, 2, 3, 4], 'invalid and rejected requests never enter queue');
  gates[0].resolve();
  await responseIs(await within(jobs[0]), 503, unavailable);
  await within(entered[1].promise);
  jobs.push(post(url, [field('job4')]));
  await within(admissions[4].promise);
  assert.deepEqual(counts, [1, 2, 3, 4, 4], 'failed active job released exactly one slot');
  for (let i = 1; i < 5; i++) {
    await within(entered[i].promise);
    assert.equal(calls, i + 1);
    gates[i].resolve();
    await responseIs(await within(jobs[i]), 200, accepted);
  }
  assert.equal(maximum, 1);
  assert.equal(readyCalls, 2);
  assert.deepEqual(events, ['analyze:job0', 'analyze:job1', 'project:job1',
    'analyze:job2', 'project:job2', 'analyze:job3', 'project:job3', 'analyze:job4', 'project:job4']);
});

test('two createApp instances do not share an executor or admission capacity', { timeout: 10000 }, async t => {
  const release = deferred(), entered = deferred();
  t.after(() => release.resolve());
  const admitted = Array.from({ length: 4 }, deferred);
  let count = 0, secondCalls = 0;
  const first = await serve(t, { ready: () => true,
    onQueued: () => admitted[count++].resolve(),
    analysisService: { analyze: async () => { entered.resolve(); await release.promise; return []; } } });
  const second = await serve(t, { ready: () => true,
    analysisService: { analyze: async () => { secondCalls++; return []; } } });
  const jobs = [];
  for (let i = 0; i < 4; i++) {
    jobs.push(post(first)); await within(admitted[i].promise);
  }
  await within(entered.promise);
  await responseIs(await post(first), 503, unavailable);
  await responseIs(await within(post(second)), 200, accepted);
  assert.equal(secondCalls, 1);
  release.resolve();
  for (const job of jobs) await responseIs(await within(job), 200, accepted);
});

test('projection failure stays inside job, releases slot and does not poison queued requests', async t => {
  const release = deferred(), entered = deferred(), secondQueued = deferred();
  t.after(() => release.resolve());
  let calls = 0;
  const events = [];
  const url = await serve(t, { ready: () => true,
    onQueued: count => { if (count === 2) secondQueued.resolve(); },
    analysisService: { analyze: async () => {
      const n = ++calls; events.push(`analyze${n}`);
      if (n === 1) {
        entered.resolve(); await release.promise;
        return [{ fieldId: 'description', get denied() { events.push('project1'); throw Error('SENTINELSECRET'); } }];
      }
      return [];
    } } });
  const first = post(url); await within(entered.promise);
  const second = post(url); await within(secondQueued.promise);
  release.resolve();
  await responseIs(await first, 503, unavailable);
  await responseIs(await second, 200, accepted);
  await responseIs(await post(url), 200, accepted);
  assert.deepEqual(events, ['analyze1', 'project1', 'analyze2', 'analyze3']);
});

test('all readiness and service failures map to 503 even with input-error class identities', async t => {
  for (const error of [new InvalidRequest('SENTINELSECRET'), new BodyTooLarge('SENTINELSECRET'),
    Error('SENTINELSECRET'), null]) {
    const url = await serve(t, { ready: () => { throw error; },
      analysisService: { analyze: async () => { throw error; } } });
    await responseIs(await fetch(url + '/health/ready'), 503, unavailable);
    await responseIs(await post(url), 503, unavailable);
  }
});

test('queue observer rejection is redacted as unavailable and subsequent admission recovers', async t => {
  let observations = 0;
  const url = await serve(t, { ready: () => true,
    onQueued: pending => {
      assert.equal(typeof pending, 'number');
      if (++observations === 1) throw new InvalidRequest('SENTINELSECRET');
    },
    analysisService: { analyze: async () => [] },
  });
  await responseIs(await post(url), 503, unavailable);
  await responseIs(await post(url), 200, accepted);
});

test('createApp requires explicit service and readiness at runtime', () => {
  for (const deps of [undefined, {}, { ready: () => true }, { analysisService: { analyze: async () => [] } }])
    assert.throws(() => createApp(deps), { name: 'TypeError', message: 'App dependencies are required' });
});

test('direct app passes original strings to service and projects only sorted public fields in UTF-16 order', async t => {
  const fields = [field('\ue000', '  e\u0301\t'), field('😀', 'é'), field('Z'), field('a')];
  let calls = 0;
  const url = await serve(t, { ready: () => true, analysisService: { analyze: async input => {
    calls++;
    assert.deepEqual(input, fields.map(f => ({ ...f, allowedCategories: [] })));
    return input.map(({ fieldId }) => ({ fieldId, denied: new Set(['PERSON', 'EMAIL_ADDRESS']),
      detected: new Set(), possible: new Set(), candidates: [{ text: 'SENTINELSECRET', score: 0.99 }] }));
  } } });
  await responseIs(await post(url, fields), 200, { verdict: 'rejected', findings:
    ['Z', 'a', '😀', '\ue000'].flatMap(fieldId => ['EMAIL_ADDRESS', 'PERSON'].map(category => ({ fieldId, category }))) });
  assert.equal(calls, 1);
});

test('invalid wire/schema never calls service, admission or readiness; exact headers on all statuses', async t => {
  let calls = 0, admissions = 0, readyCalls = 0;
  const url = await serve(t, { ready: () => { readyCalls++; }, onQueued: () => admissions++,
    analysisService: { analyze: async () => { calls++; return []; } } });
  const valid = JSON.stringify({ fields: [field()] });
  for (const body of [
    '', 'null', '[]', '{}', '{"fields":[]}', '{"fields":[null]}', '{"fields":[[]]}',
    '{"fields":[{"fieldId":"x","text":1}]}', '{"fields":[{"fieldId":1,"text":"x"}]}',
    '{"fields":[{"fieldId":"x","text":"x","allowedCategories":null}]}',
    '{"fields":[{"fieldId":"x","text":"x","allowedCategories":[1]}]}',
    '{"fields":[{"fieldId":"x","text":"x","allowedCategories":["EMAIL"]}]}',
    '{"fields":[{"fieldId":"x","text":"x","extra":0}]}',
    '{"fields":[{"fieldId":"x","text":"x"}],"extra":0}',
    '{"fields":[],"\\u0066ields":[{"fieldId":"x","text":"x"}]}',
    '{"fields":[{"fieldId":"x","text":"x","text":"y"}]}',
    '{"fields":[{"fieldId":"x","text":"\\ud800"}]}',
    '{"fields":[{"fieldId":"\\udc00","text":"x"}]}',
    '\ufeff' + valid, Buffer.from([0xff]), Buffer.from([0xc0, 0xaf]),
    JSON.stringify({ fields: [field('x'), field('x')] }),
    JSON.stringify({ fields: Array.from({ length: 11 }, (_, i) => field(String(i))) }),
    JSON.stringify({ fields: [field('x'.repeat(129))] }),
    JSON.stringify({ fields: [field('x', 'x\u0085'.repeat(51))] }),
  ]) {
    await responseIs(await fetch(url + '/v1/analyze', { method: 'POST',
      headers: { 'Content-Type': 'application/json' }, body }), 400, { code: 'invalid_request' });
  }
  for (const contentType of ['text/plain', 'application/jsonx', 'application/json-seq',
    'application/ld+json', 'application/json, text/plain', '']) {
    await responseIs(await fetch(url + '/v1/analyze', { method: 'POST',
      headers: { 'Content-Type': contentType }, body: valid }), 400, { code: 'invalid_request' });
  }
  for (const [method, path] of [['GET', '/v1/analyze'], ['PUT', '/v1/analyze'],
    ['POST', '/health/ready'], ['POST', '/v1/analyze/'], ['POST', '/v1/analyze?x=1'],
    ['GET', '/health/ready/'], ['GET', '/health/ready?x=1'], ['POST', '/v1/%61nalyze']]) {
    await responseIs(await fetch(url + path, { method, headers: { 'Content-Type': 'text/plain' },
      ...(method === 'GET' ? {} : { body: 'invalid' }) }), 404, { code: 'not_found' });
  }
  assert.equal(calls, 0); assert.equal(admissions, 0); assert.equal(readyCalls, 0);
  const exactLimit = valid + ' '.repeat(1048576 - Buffer.byteLength(valid));
  await responseIs(await fetch(url + '/v1/analyze', { method: 'POST',
    headers: { 'Content-Type': 'aPpLiCaTiOn/JsOn ; ignored=parameter' }, body: exactLimit }), 200, accepted);
  assert.equal(calls, 1); assert.equal(admissions, 1);
  await responseIs(await fetch(url + '/v1/analyze', { method: 'POST',
    headers: { 'Content-Type': 'application/json' }, body: exactLimit + ' ' }), 413, { code: 'body_too_large' });
  assert.equal(calls, 1); assert.equal(admissions, 1); assert.equal(readyCalls, 0);
});

test('route and content-type are decided before reading any request body', async t => {
  let calls = 0;
  const url = await serve(t, { ready: () => true,
    analysisService: { analyze: async () => { calls++; return []; } } });
  for (const [path, contentType, status, code] of [
    ['/v1/analyze?x=1', 'text/plain', 404, 'not_found'],
    ['/v1/analyze', 'application/jsonx', 400, 'invalid_request'],
  ]) {
    await within(new Promise((resolve, reject) => {
      const req = request(url + path, { method: 'POST', headers: {
        'Content-Type': contentType, 'Content-Length': '1048577',
      } }, res => {
        let body = '';
        res.setEncoding('utf8'); res.on('data', chunk => body += chunk);
        res.on('end', () => {
          try {
            assert.equal(res.statusCode, status);
            assert.equal(res.headers['content-type'], 'application/json');
            assert.equal(res.headers['x-content-type-options'], 'nosniff');
            assert.deepEqual(JSON.parse(body), { code });
            resolve();
          } catch (error) { reject(error); }
          finally { req.destroy(); }
        });
      });
      req.on('error', reject);
      req.setTimeout(2000, () => req.destroy(Error('headers/body ordering timeout')));
      req.flushHeaders(); // Deliberately never send a body or EOF.
    }));
  }
  assert.equal(calls, 0);
});

test('compiled HTTP import graph cannot load SDK/analysis, read env, listen or fetch', () => {
  const appUrl = new URL('../../poc-horizon/dist/app.js', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    import { Server } from 'node:net';
    Server.prototype.listen = () => { throw Error('forbidden listen'); };
    globalThis.fetch = () => { throw Error('forbidden fetch'); };
    const environment = process.env;
    process.env = new Proxy(environment, { get(target, key) {
      if (String(key).startsWith('ANALYZER_')) throw Error('forbidden import-time configuration');
      return target[key];
    } });
    registerHooks({ resolve(specifier, context, next) {
      assert.doesNotMatch(specifier, /@huggingface|detector\\.js|analyze-fields\\.js/,
        'model runtime forbidden in HTTP boundary');
      return next(specifier, context);
    } });
    const { createApp } = await import(${JSON.stringify(appUrl)});
    let effects = 0;
    assert.equal(typeof createApp({ ready: () => effects++,
      analysisService: { analyze: async () => { effects++; return []; } } }), 'function');
    assert.equal(effects, 0);
    console.log('HTTP import isolation verified');
  `], { encoding: 'utf8', timeout: 10000 });
  assert.ifError(result.error);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /HTTP import isolation verified/);
});

test('config reads only when called, preserves Number conversion, zero port and host bytes', () => {
  assert.deepEqual(loadConfig({}), { port: 8000, bindHost: '127.0.0.1' });
  for (const [value, expected] of [['0', 0], ['', 0], [' 42 ', 42], ['0x10', 16]])
    assert.equal(loadConfig({ ANALYZER_PORT: value }).port, expected);
  assert.ok(Number.isNaN(loadConfig({ ANALYZER_PORT: 'bad' }).port));
  assert.equal(loadConfig({ ANALYZER_BIND_HOST: ' LOCALHOST ' }).bindHost, ' LOCALHOST ');
  assert.equal(loadConfig({ ANALYZER_BIND_HOST: '' }).bindHost, '');
  assert.deepEqual(HTTP_LIMITS, { maxBodyBytes: 1048576, maxFields: 10, maxFieldIdUnits: 128,
    maxWords: 50, maxPending: 4, requestTimeout: 10000 });
});
