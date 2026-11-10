import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { runFunctional, parseArguments } from '../functional/run.mjs';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { loadCapabilities } from '../functional/config.mjs';

const secret = 'SENTINEL_PRIVATE_INPUT';
const versions = Object.fromEntries(Object.entries((await loadCapabilities()).engines).map(([n,e])=>[n,e.version]));
const digest = name => `sha256:${(name === 'presidio' ? 'a' : 'b').repeat(64)}`;
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
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = JSON.parse(Buffer.concat(chunks));
        calls[engine].push(body);
        const forced = overrides[engine]?.(body, calls[engine].length);
        if (forced) {
          res.writeHead(forced.status, { 'content-type': forced.type ?? 'application/json' });
          res.end(forced.body ?? JSON.stringify({ code: 'ANALYZER_UNAVAILABLE' }));
          return;
        }
        const field = body.fields[0];
        const smokeLabels = { 'contatto@example.com': 'EMAIL_ADDRESS',
          'VRDDAA80A01H501A': 'IT_FISCAL_CODE', '12345678903': 'IT_VAT_CODE',
          'IT60X0542811101000000123456': 'IBAN_CODE' };
        const type = field.text === secret && !field.allowedEntityTypes.includes('PERSON') ? 'PERSON' :
          smokeLabels[field.text] && !field.allowedEntityTypes.includes(smokeLabels[field.text]) ? smokeLabels[field.text] : null;
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
], review: { status: 'independently-reviewed' }, corpusHashes: { gold: 'a'.repeat(64) }, manifestHashes: { gold: 'c'.repeat(64) } });
const tinyCaps = () => ({ alignmentStatus: 'independently-reviewed', engines: Object.fromEntries(['presidio', 'horizon'].map(name => [name, {
  mapping: Object.fromEntries(['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE'].map(c => [c, c])),
  capabilities: { PERSON: { scope: 'synthetic' } }, version: versions[name],
}])), artifactSha256: 'e'.repeat(64) });
const dependencies = (urls, events) => ({
  loadCorpus: async () => tinyPlan(), loadCapabilities: async () => tinyCaps(),
  countTokens: async () => 8,
  createRunner: () => ({ withContainer: async (image, engine, callback) => {
    events.push(engine);
    return callback({ name: `fake-${engine}`, url: urls[engine], imageId: digest(engine), signal: new AbortController().signal });
  } }),
  activeRegistry: async () => Object.keys(tinyCaps().engines.presidio.mapping),
  policyVersions: versions,
  gitMetadata: () => ({ commit: 'f'.repeat(40), dirty: true }),
  expectedImageIds: { presidio: digest('presidio'), horizon: digest('horizon') },
  validateReleaseBundle: bundle => bundle,
});

test('strict CLI arguments distinguish validate, render and live modes', () => {
  assert.deepEqual(parseArguments(['--validate-only']), { mode: 'validate' });
  assert.deepEqual(parseArguments(['--render', '/tmp/results.json', '--output-dir', '/tmp/report']),
    { mode: 'render', results: '/tmp/results.json', outputDir: '/tmp/report' });
  assert.throws(() => parseArguments(['--presidio-image', 'a']), /INVALID_ARGUMENTS/);
  assert.throws(() => parseArguments(['--validate-only', '--output-dir', '/tmp/unused']), /INVALID_ARGUMENTS/);
  assert.throws(() => parseArguments(['--render', 'x', '--presidio-image', 'x']), /INVALID_ARGUMENTS/);
});

test('validate-only verifies frozen corpus and capabilities without starting services', async () => {
  let created = false;
  const result = await runFunctional(['--validate-only'], {
    loadCorpus, loadCapabilities, countTokens: async () => 8,
    createRunner: () => { created = true; throw new Error('started'); },
  });
  assert.equal(result.mode, 'validate');
  assert.equal(result.detection, (await loadCorpus()).detection.length);
  assert.equal(result.policy, (await loadCorpus()).policy.length);
  assert.equal(created, false);
});

test('fake loopback services produce sanitized atomic bundle, manifest and reports with isolated containers', async () => {
  await fixture(async dir => fakeServices(async ({ calls, urls }) => {
    const events = [];
    const outputDir = join(dir, 'run');
    const result = await runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', outputDir],
      dependencies(urls, events));
    assert.equal(result.status, 'complete');
    assert.deepEqual(events, ['presidio', 'horizon']);
    assert.equal(calls.presidio.length, 5); // Two independent smoke calls precede measured probes.
    assert.equal(calls.horizon.length, 8); // Horizon also checks three Italian recognizers.
    assert.deepEqual(calls.presidio.slice(2).map(x => x.fields[0].allowedEntityTypes), [[], [], ['PERSON']]);
    const names = (await readdir(outputDir)).sort();
    assert.deepEqual(names, ['report.md', 'results.json', 'run-manifest.json', 'sensitivity.csv', 'summary.json', 'verdict.csv']);
    const bundle = JSON.parse(await readFile(join(outputDir, 'results.json'), 'utf8'));
    const manifest = JSON.parse(await readFile(join(outputDir, 'run-manifest.json'), 'utf8'));
    assert.equal(bundle.policyUnits.length, 2);
    assert.equal(bundle.detectionUnits.length, 1);
    assert.equal(bundle.observations.presidio.policy['case-two'].verdict, 'accepted');
    assert.equal(manifest.engines.presidio.imageId, digest('presidio'));
    assert.equal(manifest.engines.horizon.modelPolicyVersion, versions.horizon);
    assert.match(manifest.lockSha256.presidio, /^[a-f0-9]{64}$/);
    assert.match(manifest.lockSha256.horizon, /^[a-f0-9]{64}$/);
    assert.equal(manifest.engines.horizon.modelVersion, versions.horizon);
    assert.deepEqual(manifest.planned, { detection: 1, policy: 2, totalRequests: 6 });
    assert.equal(JSON.parse(await readFile(join(outputDir, 'summary.json'), 'utf8')).policy.paired.presidio.counts.tp, 1);
    for (const name of names) assert.ok(!(await readFile(join(outputDir, name), 'utf8')).includes(secret), name);
    await assert.rejects(runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', outputDir],
      dependencies(urls, events)), /OUTPUT_EXISTS/);
    assert.deepEqual(events, ['presidio', 'horizon']);
  }));
});

test('standalone render accepts only existing sanitized results and never loads corpus or Docker', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const first = join(dir, 'first');
    await runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', first],
      dependencies(urls, []));
    const isolated = join(dir, 'isolated.json');
    await writeFile(isolated, await readFile(join(first, 'results.json')));
    const result = await runFunctional(['--render', isolated, '--output-dir', join(dir, 'rendered')], {
      loadCorpus: () => { throw Error('corpus opened'); }, createRunner: () => { throw Error('docker opened'); },
      validateStandaloneReleaseBundle: bundle => bundle,
    });
    assert.equal(result.status, 'complete');
    for (const name of ['summary.json', 'sensitivity.csv', 'verdict.csv', 'report.md'])
      assert.equal(await readFile(join(first, name), 'utf8'), await readFile(join(dir, 'rendered', name), 'utf8'));
    const tampered = JSON.parse(await readFile(isolated, 'utf8'));
    tampered.policyUnits[0].expectedVerdict = 'accepted';
    await writeFile(isolated, JSON.stringify(tampered));
    await assert.rejects(runFunctional(['--render', isolated, '--output-dir', join(dir, 'rejected')], {
      validateStandaloneReleaseBundle: bundle => {
        if (bundle.policyUnits[0].expectedVerdict !== 'rejected') throw Error('INVALID_BUNDLE');
      },
    }), /INVALID_BUNDLE/);
  }));
});

test('CLI rejects unknown flags with generic stderr and no raw value', () => {
  const result = spawnSync(process.execPath, ['comparison/functional/run.mjs', '--bogus', secret], {
    cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  assert.ok(!result.stderr.includes(secret));
  assert.ok(!result.stdout.includes(secret));
});

test('registry mismatch stops before smoke or corpus inference and leaves incomplete evidence', async () => {
  await fixture(async dir => fakeServices(async ({ urls, calls }) => {
    const deps = { ...dependencies(urls, []), activeRegistry: async () => [] };
    const outputDir = join(dir, 'registry-failed');
    await assert.rejects(runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', outputDir], deps),
      /UNVERIFIED_PRESIDIO_REGISTRY/);
    assert.equal(calls.presidio.length, 0);
    assert.equal(calls.horizon.length, 0);
    const bundle = JSON.parse(await readFile(join(outputDir, 'results.json'), 'utf8'));
    assert.equal(bundle.runStatus, 'incomplete');
    assert.deepEqual(bundle.observations.presidio.detection, {});
    assert.match(await readFile(join(outputDir, 'report.md'), 'utf8'), /INCOMPLETE/);
  }));
});

test('503 is technical, preserves detection and returns incomplete without raw response', async () => {
  await fixture(async dir => fakeServices(async ({ urls }) => {
    const outputDir = join(dir, 'degraded');
    const result = await runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', outputDir],
      dependencies(urls, []));
    assert.equal(result.status, 'incomplete');
    const bundle = JSON.parse(await readFile(join(outputDir, 'results.json'), 'utf8'));
    const summary = JSON.parse(await readFile(join(outputDir, 'summary.json'), 'utf8'));
    assert.equal(bundle.observations.presidio.detection['detection-0001'].status, 200);
    assert.equal(bundle.observations.presidio.policy['case-one'].status, 503);
    assert.equal(summary.coverage.presidio.policy.technicalErrors, 1);
    assert.equal(summary.coverage.presidio.detection.successes, 1);
    assert.ok(!(await readFile(join(outputDir, 'report.md'), 'utf8')).includes(secret));
  }, { presidio: (_body, count) => count === 4 ? { status: 503 } : undefined }));
});

test('malformed HTTP response stops on first invalid probe and keeps sanitized unattempted units', async () => {
  await fixture(async dir => fakeServices(async ({ urls, calls }) => {
    const outputDir = join(dir, 'invalid');
    await assert.rejects(runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', outputDir],
      dependencies(urls, [])), /INVALID_RESPONSE/);
    assert.equal(calls.presidio.length, 3);
    assert.equal(calls.horizon.length, 0);
    const bundle = JSON.parse(await readFile(join(outputDir, 'results.json'), 'utf8'));
    const summary = JSON.parse(await readFile(join(outputDir, 'summary.json'), 'utf8'));
    assert.deepEqual(bundle.observations.presidio.detection['detection-0001'], { status: 'contract-error' });
    assert.equal(summary.coverage.presidio.policy.unattempted, 2);
    assert.equal(summary.coverage.horizon.detection.unattempted, 1);
    for (const file of await readdir(outputDir))
      assert.ok(!(await readFile(join(outputDir, file), 'utf8')).includes(secret));
  }, { presidio: (_body, count) => count === 3 ? { status: 200, body: secret, type: 'text/plain' } : undefined }));
});

test('reviewed full plan survives real release gate and standalone render from results alone', async () => {
  await fixture(async dir => fakeServices(async ({ urls, calls }) => {
    const first = join(dir, 'reviewed');
    const caps = await loadCapabilities();
    const deps = { ...dependencies(urls, []), loadCorpus: async()=>({...await loadCorpus(), review:{status:'independently-reviewed'}}), loadCapabilities: async()=>({...await loadCapabilities(),alignmentStatus:'independently-reviewed'}),
      activeRegistry: async () => Object.keys(caps.engines.presidio.mapping) };
    delete deps.validateReleaseBundle;

    const result = await runFunctional(['--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', first], deps);
    assert.equal(result.status, 'complete');
    assert.equal(calls.presidio.length, (await loadCorpus()).detection.length+(await loadCorpus()).policy.length+2);
    assert.equal(calls.horizon.length, (await loadCorpus()).detection.length+(await loadCorpus()).policy.length+5);
    const standalone = join(dir, 'standalone.json');
    await writeFile(standalone, await readFile(join(first, 'results.json')));
    const rendered = join(dir, 'rendered');
    assert.deepEqual(await runFunctional(['--render', standalone, '--output-dir', rendered]),
      { mode: 'render', status: 'complete' });
    assert.equal(await readFile(join(first, 'summary.json'), 'utf8'),
      await readFile(join(rendered, 'summary.json'), 'utf8'));
    assert.equal(JSON.parse(await readFile(standalone, 'utf8')).detectionUnits.length, (await loadCorpus()).detection.length);
  }));
});
