import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { runFunctional, parseArguments } from '../functional/run.mjs';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { loadCapabilities } from '../functional/config.mjs';
import { validateReleaseBundle } from '../functional/metrics.mjs';

const secret = 'SENTINEL_PRIVATE_INPUT';
const versions = { presidio: 'observed-presidio-v42', horizon: 'observed-horizon-v42' };
const imageId = name => `sha256:${(name === 'presidio' ? 'a' : 'b').repeat(64)}`;
const network = { mode: 'default', names: ['bridge'] };
async function fixture(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'functional-run-'));
  try { return await fn(dir); } finally { await rm(dir, { recursive: true, force: true }); }
}
async function fakeServices(fn, overrides = {}) {
  const calls = { presidio: [], horizon: [] };
  const servers = [];
  const urls = {};
  try {
    for (const engine of ['presidio', 'horizon']) {
      const server = createServer(async (req, res) => {
        if (req.url === '/health/ready') {
          res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"status":"ready"}'); return;
        }
        assert.equal(req.headers.authorization, undefined); // Neither current service requires auth.
        assert.equal(req.url, '/v1/analyze');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        calls[engine].push(body);
        const forced = overrides[engine]?.(body, calls[engine].length);
        if (forced) {
          res.writeHead(forced.status, { 'content-type': forced.type ?? 'application/json' });
          res.end(forced.body ?? JSON.stringify({ code: forced.status === 400 ? 'INVALID_ANALYZE_REQUEST' : 'ANALYZER_UNAVAILABLE' }));
          return;
        }
        const field = body.fields[0];
        const type = field.text === secret && !field.allowedEntityTypes.includes('PERSON') ? 'PERSON' : null;
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ verdict: type ? 'rejected' : 'accepted', modelPolicyVersion: versions[engine],
          findings: type ? [{ fieldId: field.fieldId, entityType: type }] : [] }));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      urls[engine] = `http://127.0.0.1:${server.address().port}`;
    }
    return await fn({ calls, urls });
  } finally { await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve)))); }
}
const tinyPlan = () => ({ detection: [
  { detectionCaseId: 'detection-0001', sourceIds: ['case-one', 'case-two'], text: secret,
    fieldId: 'description', expectedEntities: ['PERSON'], split: 'development', familyId: 'family',
    strata: [{ sourceId: 'case-one', focusCategory: 'PERSON', scenario: 'positive' },
      { sourceId: 'case-two', focusCategory: 'PERSON', scenario: 'allowlisted' }] },
], policy: [
  { id: 'case-one', text: secret, fieldId: 'description', expectedEntities: ['PERSON'],
    allowedEntityTypes: [], expectedVerdict: 'rejected', split: 'development', familyId: 'family',
    focusCategory: 'PERSON', focusPolarity: 'positive', scenario: 'positive', provenanceId: 'synthetic', annotationStatus: 'independently-reviewed' },
  { id: 'case-two', text: secret, fieldId: 'description', expectedEntities: ['PERSON'],
    allowedEntityTypes: ['PERSON'], expectedVerdict: 'accepted', split: 'development', familyId: 'family',
    focusCategory: 'PERSON', focusPolarity: 'positive', scenario: 'allowlisted', provenanceId: 'synthetic', annotationStatus: 'independently-reviewed' },
], review: { status: 'independently-reviewed' }, manifest: { synthetic: true } });
const dependencies = (urls, events) => ({
  loadCorpus: async () => tinyPlan(), loadCapabilities,
  countTokens: async () => 8,
  createRunner: () => ({ withContainer: async (image, engine, callback) => {
    events.push(engine + ':start');
    try { return await callback({ name: `fake-${engine}`, url: urls[engine], imageId: imageId(engine),
      network, bind: '127.0.0.1', signal: new AbortController().signal }); }
    finally { events.push(engine + ':stop'); }
  } }),
  gitMetadata: () => ({ commit: 'f'.repeat(40), dirty: true }),
});
const runArgs = output => ['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', output];

test('CLI smoke accepts Horizon native EMAIL without interpreting it as Presidio vocabulary', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const result = await runFunctional(runArgs(join(dir, 'native-smoke')), {
      ...dependencies(urls, []),
    });
    assert.equal(result.status, 'complete');
  }, { horizon: (body,n) => n === 1 ? { status:200, body:JSON.stringify({
    verdict:'rejected',modelPolicyVersion:versions.horizon,
    findings:[{fieldId:'description',entityType:'EMAIL'}],
  }) } : null }));
});

test('strict CLI arguments distinguish validate, render and live modes', () => {
  assert.deepEqual(parseArguments(['--validate-only']), { mode: 'validate' });
  assert.deepEqual(parseArguments(['--render', 'results.json', '--output-dir', 'report']),
    { mode: 'render', results: 'results.json', outputDir: 'report' });
  for (const args of [['--presidio-image', 'a'], ['--validate-only', '--output-dir', 'unused'],
    ['--render', 'x', '--presidio-image', 'x']]) assert.throws(() => parseArguments(args), /INVALID_ARGUMENTS/);
});

test('HTTP run uses reviewed gold without hashes, expected image IDs or capability approval', async () => {
  await fixture(async dir => fakeServices(async ({ calls, urls }) => {
    const events = [];
    let loads = 0;
    const output = join(dir, 'run');
    const result = await runFunctional(runArgs(output), { ...dependencies(urls, events),
      loadCorpus: async () => { loads++; return tinyPlan(); } });
    assert.equal(result.status, 'complete');
    assert.equal(loads, 1);
    assert.deepEqual(events, ['presidio:start', 'presidio:stop', 'horizon:start', 'horizon:stop']);
    for (const name of ['presidio', 'horizon']) {
      assert.equal(calls[name].length, 4); // One HTTP-contract smoke, then three measured probes.
      assert.deepEqual(calls[name].slice(1).map(x => x.fields[0].allowedEntityTypes), [[], [], ['PERSON']]);
    }
    const files = (await readdir(output)).sort();
    assert.deepEqual(files, ['report.md', 'results.json', 'run-manifest.json', 'sensitivity.csv', 'summary.json', 'verdict.csv']);
    const bundle = JSON.parse(await readFile(join(output, 'results.json')));
    const manifest = JSON.parse(await readFile(join(output, 'run-manifest.json')));
    assert.equal(bundle.policyUnits.length, 2);
    assert.equal(bundle.detectionUnits.length, 1);
    assert.equal(bundle.observations.presidio.policy['case-two'].verdict, 'accepted');
    assert.equal(Object.hasOwn(bundle, 'integrity'), false);
    assert.equal(manifest.engines.presidio.imageId, imageId('presidio'));
    assert.equal(manifest.engines.horizon.modelPolicyVersion, versions.horizon);
    assert.deepEqual(manifest.engines.horizon.network, network);
    assert.equal(manifest.engines.horizon.bind, '127.0.0.1');
    assert.equal(manifest.reviewStatus, 'independently-reviewed');
    assert.ok(manifest.runId);
    assert.deepEqual(manifest.planned, { detection: 1, policy: 2, totalRequests: 6 });
    assert.doesNotMatch(JSON.stringify(manifest), /corpusHash|manifestHash|capabilitiesSha|lockSha|runnerSha|resources|cpus|memory/);
    for (const name of files) assert.ok(!(await readFile(join(output, name), 'utf8')).includes(secret), name);
    await assert.rejects(runFunctional(runArgs(output), dependencies(urls, events)), /OUTPUT_EXISTS/);
    assert.equal(events.length, 4);
  }));
});

test('rejects an invalid collected bundle before writing results and keeps a safe failure receipt', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const output = join(dir, 'invalid-bundle');
    await assert.rejects(runFunctional(runArgs(output), { ...dependencies(urls, []),
      validateReleaseBundle: (bundle, plan) => {
        if (Object.keys(bundle.observations.presidio.detection).length) bundle.rawBody = secret;
        return validateReleaseBundle(bundle, plan);
      } }), /INVALID_BUNDLE/);
    assert.deepEqual(await readdir(output), ['run-manifest.json']);
    const receipt = JSON.parse(await readFile(join(output, 'run-manifest.json')));
    assert.equal(receipt.runStatus, 'incomplete');
    assert.equal(receipt.failureCode, 'INVALID_BUNDLE');
    assert.ok(!JSON.stringify(receipt).includes(secret));
  }));
});

test('short input matching an allowed metadata value does not trip a substring export gate', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const plan = tinyPlan();
    for (const unit of [...plan.detection, ...plan.policy]) unit.text = 'PERSON';
    const output = join(dir, 'short-input');
    const result = await runFunctional(runArgs(output), { ...dependencies(urls, []), loadCorpus: async () => plan });
    assert.equal(result.status, 'complete');
    const saved = await readFile(join(output, 'results.json'), 'utf8');
    assert.doesNotMatch(saved, /"(?:text|rawBody|rationale)"\s*:/);
  }));
});

test('validate-only reports pending review without Docker, but run retains the gold review gate', async () => {
  const deps = { loadCorpus: async () => ({ ...tinyPlan(), review: { status: 'pending' } }),
    loadCapabilities, countTokens: async () => 8, createRunner: () => assert.fail('Docker must not start') };
  assert.deepEqual(await runFunctional(['--validate-only'], deps), {
    mode: 'validate', detection: 1, policy: 2, reviewStatus: 'pending' });
  await fixture(async dir => {
    await assert.rejects(runFunctional(runArgs(join(dir, 'blocked')), deps), /GOLD_REVIEW_PENDING/);
    assert.deepEqual(await readdir(dir), []);
  });
});

test('standalone rendering uses only the saved bundle and rejects raw additions', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const first = join(dir, 'first');
    await runFunctional(runArgs(first), dependencies(urls, []));
    const isolated = join(dir, 'saved.json');
    await writeFile(isolated, await readFile(join(first, 'results.json')));
    const forbidden = () => assert.fail('render must not read current inputs');
    const output = join(dir, 'rendered');
    assert.deepEqual(await runFunctional(['--render', isolated, '--output-dir', output], {
      loadCorpus: forbidden, loadCapabilities: forbidden, countTokens: forbidden, createRunner: forbidden,
    }), { mode: 'render', status: 'complete' });
    for (const name of ['summary.json', 'sensitivity.csv', 'verdict.csv', 'report.md'])
      assert.equal(await readFile(join(first, name), 'utf8'), await readFile(join(output, name), 'utf8'));
    const invalid = JSON.parse(await readFile(isolated));
    invalid.policyUnits[0].rawBody = secret;
    await writeFile(isolated, JSON.stringify(invalid));
    await assert.rejects(runFunctional(['--render', isolated, '--output-dir', join(dir, 'rejected')]), /INVALID_BUNDLE/);
  }));
});

for (const status of [400, 503]) test(`HTTP ${status} preserves successful detection and planned units`, async () => {
  await fixture(async dir => fakeServices(async ({ urls, calls }) => {
    const output = join(dir, 'error');
    const events = [];
    const running = runFunctional(runArgs(output), dependencies(urls, events));
    if (status === 400) await assert.rejects(running, /INVALID_ANALYZE_REQUEST/);
    else assert.equal((await running).status, 'incomplete');
    const bundle = JSON.parse(await readFile(join(output, 'results.json')));
    const summary = JSON.parse(await readFile(join(output, 'summary.json')));
    assert.equal(bundle.observations.presidio.detection['detection-0001'].status, 200);
    assert.equal(bundle.observations.presidio.policy['case-one'].status, status === 400 ? 'contract-error' : 503);
    assert.equal(summary.coverage.presidio.detection.successes, 1);
    if (status === 400) {
      assert.equal(summary.coverage.presidio.policy.unattempted, 1);
      assert.equal(summary.coverage.horizon.detection.unattempted, 1);
      assert.equal(calls.horizon.length, 0);
    } else assert.equal(summary.coverage.presidio.policy.technicalErrors, 1);
    assert.match(events.join(','), /presidio:start,presidio:stop/);
  }, { presidio: (_body, count) => count === 3 ? { status } : undefined }));
});

for (const kind of ['malformed', 'version']) test(`${kind} response stops at the failed probe and leaves the rest unattempted`, async () => {
  await fixture(async dir => fakeServices(async ({ urls, calls }) => {
    const output = join(dir, 'error');
    await assert.rejects(runFunctional(runArgs(output), dependencies(urls, [])),
      kind === 'malformed' ? /INVALID_RESPONSE/ : /POLICY_VERSION_MISMATCH/);
    const bundle = JSON.parse(await readFile(join(output, 'results.json')));
    const summary = JSON.parse(await readFile(join(output, 'summary.json')));
    assert.equal(calls.presidio.length, 2);
    assert.equal(calls.horizon.length, 0);
    assert.deepEqual(bundle.observations.presidio.detection['detection-0001'], { status: 'contract-error' });
    assert.equal(summary.coverage.presidio.policy.unattempted, 2);
    assert.equal(summary.coverage.horizon.detection.unattempted, 1);
    for (const name of await readdir(output)) assert.ok(!(await readFile(join(output, name), 'utf8')).includes(secret));
  }, { presidio: (_body, count) => count === 2 ? { status: 200,
    body: kind === 'malformed' ? secret : JSON.stringify({ verdict: 'accepted', findings: [], modelPolicyVersion: 'changed-version' }) } : undefined }));
});

test('startup failure keeps all planned units unattempted and redacts its error', async () => {
  await fixture(async dir => {
    const output = join(dir, 'startup-failed');
    await assert.rejects(runFunctional(runArgs(output), { ...dependencies({}, []),
      createRunner: () => { throw new Error(secret); } }), { message: 'FUNCTIONAL_RUN_FAILED' });
    const bundle = JSON.parse(await readFile(join(output, 'results.json')));
    const receipt = JSON.parse(await readFile(join(output, 'run-manifest.json')));
    assert.equal(bundle.runStatus, 'incomplete');
    assert.equal(bundle.policyUnits.length, 2);
    assert.deepEqual(bundle.observations.presidio, { detection: {}, policy: {} });
    assert.equal(receipt.failureCode, 'FUNCTIONAL_RUN_FAILED');
    assert.ok(!JSON.stringify(receipt).includes(secret));
  });
});

test('result write failure leaves an incomplete receipt and no temporary payload files', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const output = join(dir, 'write-failed');
    const deps = dependencies(urls, []);
    const original = deps.createRunner;
    deps.createRunner = () => ({ withContainer: async (image, name, callback) => {
      const result = await original().withContainer(image, name, callback);
      if (name === 'horizon') await mkdir(join(output, 'results.json'));
      return result;
    } });
    await assert.rejects(runFunctional(runArgs(output), deps), { message: 'OUTPUT_FAILED' });
    const receipt = JSON.parse(await readFile(join(output, 'run-manifest.json')));
    assert.equal(receipt.runStatus, 'incomplete');
    assert.equal(receipt.failureCode, 'OUTPUT_FAILED');
    assert.ok(!(await readdir(output)).some(name => name.endsWith('.tmp')));
  }));
});

test('CLI rejects unknown flags with a safe error and no argument echo', () => {
  const result = spawnSync(process.execPath, ['comparison/functional/run.mjs', '--bogus', secret], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.equal(result.stderr.trim(), 'INVALID_ARGUMENTS');
  assert.ok(!result.stdout.includes(secret));
});
