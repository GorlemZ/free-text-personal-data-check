// Functional suite entrypoint. No detector, Docker or corpus work at import time.
import { mkdir, readFile, writeFile, rename } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadCorpus } from './load-corpus.mjs';
import { loadCapabilities, countHorizonTokens, freezeTokenLimits, verifyActivePresidioRegistry } from './config.mjs';
import { createFunctionalDockerRunner, dockerCommand } from './docker-runner.mjs';
import { validateReleaseBundle, analyzeBundle, sanitizedPlanSha256 } from './metrics.mjs';
import { renderReport } from './report.mjs';
import { post } from '../http-client.mjs';
import { requestFor, assertAnalyzeResponse } from '../contract.mjs';
import { createBundle, collectEngine } from './collect.mjs';

const engines = ['presidio', 'horizon'];
const fail = message => { throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';
async function lockHashes() {
  const values = await Promise.all(['poc-spacy/uv.lock', 'poc-horizon/package-lock.json'].map(async path =>
    createHash('sha256').update(await readFile(new URL(`../../${path}`, import.meta.url))).digest('hex')));
  return Object.fromEntries(engines.map((name, i) => [name, values[i]]));
}

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--validate-only') return { mode: 'validate' };
  if (args.length === 4 && args[0] === '--render' && args[2] === '--output-dir' &&
      args[1] && args[3]) return { mode: 'render', results: args[1], outputDir: args[3] };
  if (args.length === 6 && new Set([args[0], args[2], args[4]]).size === 3 &&
      ['--presidio-image', '--horizon-image', '--output-dir'].every(flag => args.includes(flag)) &&
      args.every((arg, index) => index % 2 === 0 || (arg && !arg.startsWith('--')))) {
    const values = Object.fromEntries([0, 2, 4].map(i => [args[i], args[i + 1]]));
    return { mode: 'run', images: { presidio: values['--presidio-image'],
      horizon: values['--horizon-image'] }, outputDir: values['--output-dir'] };
  }
  return fail('INVALID_ARGUMENTS');
}

async function newOutput(path) {
  try { await mkdir(dirname(resolve(path)), { recursive: true }); await mkdir(path); }
  catch (error) { fail(error?.code === 'EEXIST' ? 'OUTPUT_EXISTS' : 'OUTPUT_FAILED'); }
}
async function atomicFile(directory, name, content) {
  const target = resolve(directory, name);
  const temporary = `${target}.${randomUUID()}.tmp`;
  await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
  await rename(temporary, target);
}
function safeEvidence(bundle, plan) {
  const value = JSON.stringify(bundle);
  if (plan.detection.some(unit => value.includes(unit.text))) fail('REPORT_CONTAINS_INPUT');
}
function gitMetadata() {
  const base = fileURLToPath(new URL('../../', import.meta.url));
  const call = args => {
    const result = spawnSync('git', args, { cwd: base, encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0) fail('GIT_METADATA_FAILED');
    return result.stdout.trim();
  };
  return { commit: call(['rev-parse', 'HEAD']), dirty: Boolean(call(['status', '--porcelain'])) };
}
async function sourcePolicyVersions() {
  const sources = {
    presidio: new URL('../../poc-spacy/src/free_text_personal_data_check/analyzer.py', import.meta.url),
    horizon: new URL('../../poc-horizon/src/detector.mjs', import.meta.url),
  };
  const values = {};
  for (const name of engines) {
    const source = await readFile(sources[name], 'utf8');
    const match = source.match(/^\s*(?:export const )?MODEL_POLICY_VERSION\s*=\s*['"]([^'"\r\n]+)['"]/m);
    if (!match) fail('POLICY_VERSION_UNVERIFIED');
    values[name] = match[1];
  }
  return values;
}
async function activeRegistry(name) {
  const script = 'import json; from free_text_personal_data_check.analyzer import get_analyzer; print(json.dumps(sorted(get_analyzer().get_supported_entities(language="it"))))';
  const output = dockerCommand(['exec', name, '/app/.venv/bin/python', '-c', script]);
  try { return JSON.parse(output); } catch { fail('UNVERIFIED_PRESIDIO_REGISTRY'); }
}
async function ready(url, signal) {
  const deadline = Date.now() + 120000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health/ready`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
      });
      if (response.status === 200 && (await response.json())?.status === 'ready') return;
    } catch { /* bounded readiness retry, never expose response */ }
    await delay(300, undefined, { signal });
  }
  fail(signal.aborted ? 'INTERRUPTED' : 'READINESS_TIMEOUT');
}
async function smoke(url, name, policyVersion, labels, signal) {
  const samples = [
    ['Servizio digitale.', null],
    ['contatto@example.com', 'EMAIL_ADDRESS'],
    ...(name === 'horizon' ? [
      ['VRDDAA80A01H501A', 'IT_FISCAL_CODE'],
      ['12345678903', 'IT_VAT_CODE'],
      ['IT60X0542811101000000123456', 'IBAN_CODE'],
    ] : []),
  ];
  for (const [text, expected] of samples) {
    const response = await post(url, JSON.stringify({ fields: [{ fieldId: 'description', text,
      allowedEntityTypes: [] }] }), { signal });
    if (response.status !== 200) fail('SMOKE_FAILED');
    assertAnalyzeResponse(response.status, response.body, labels,
      { fieldId: 'description', allowedEntityTypes: [] });
    if (response.body.modelPolicyVersion !== policyVersion) fail('POLICY_VERSION_MISMATCH');
    if ((expected && !response.body.findings.some(f => f.entityType === expected)) ||
        (!expected && response.body.verdict !== 'accepted')) fail('SMOKE_FAILED');
  }
}
async function writeReports(directory, bundle, validate) {
  validate(bundle);
  const summary = analyzeBundle(bundle);
  const rendered = renderReport(summary);
  for (const [name, text] of Object.entries({ 'summary.json': rendered.summaryJson,
    'sensitivity.csv': rendered.sensitivityCsv, 'verdict.csv': rendered.verdictCsv,
    'report.md': rendered.markdown })) await atomicFile(directory, name, text);
  return summary;
}

/** Dependency injection is for deterministic tests; CLI always uses the real adapters. */
export async function runFunctional(args, overrides = {}) {
  const parsed = parseArguments(args);
  const deps = { loadCorpus, loadCapabilities, countTokens: countHorizonTokens,
    createRunner: createFunctionalDockerRunner, activeRegistry,
    gitMetadata, policyVersions: null, expectedImageIds: null, validateReleaseBundle, ...overrides };
  if (parsed.mode === 'render') {
    const bundle = JSON.parse(await readFile(parsed.results, 'utf8'));
    // This gate does not read current corpus, capabilities, models, or Docker state.
    const validate = deps.validateStandaloneReleaseBundle ?? (value => validateReleaseBundle(value));
    validate(bundle);
    await newOutput(parsed.outputDir);
    const summary = await writeReports(parsed.outputDir, bundle, validate);
    return { mode: 'render', status: summary.runStatus };
  }
  const plan = await deps.loadCorpus();
  const capabilities = await deps.loadCapabilities();
  const frozen = await freezeTokenLimits(plan, deps.countTokens);
  if (parsed.mode === 'validate') return { mode: 'validate', detection: frozen.detection.length,
    policy: frozen.policy.length, reviewStatus: plan.review?.status, alignmentStatus: capabilities.alignmentStatus };
  if (plan.review?.status !== 'independently-reviewed') fail('GOLD_REVIEW_PENDING');
  if (capabilities.alignmentStatus !== 'independently-reviewed') fail('CAPABILITY_ALIGNMENT_PENDING');
  const imageIds = deps.expectedImageIds ?? Object.fromEntries(engines.map(name => [name, capabilities.engines[name].expectedImageId]));
  if (engines.some(name => !/^sha256:[a-f0-9]{64}$/.test(imageIds[name] ?? ''))) fail('IMAGE_CONFIGURATION_PENDING');
  const policyVersions = deps.policyVersions ?? await sourcePolicyVersions();
  for (const name of engines) if (policyVersions[name] !== capabilities.engines[name].version)
    fail('POLICY_VERSION_UNVERIFIED');
  const bundle = createBundle(frozen, capabilities);
  bundle.integrity = { corpusSha256: frozen.corpusHashes.gold,
    manifestSha256: frozen.manifestHashes.gold, reviewStatus: frozen.review.status,
    planSha256: sanitizedPlanSha256(bundle) };
  safeEvidence(bundle, frozen);
  await newOutput(parsed.outputDir);
  const manifest = { schemaVersion: 1, runStatus: 'incomplete', git: deps.gitMetadata(),
    architecture: process.arch, corpusHashes: frozen.corpusHashes,
    manifestHashes: frozen.manifestHashes, capabilitiesSha256: capabilities.artifactSha256,
    lockSha256: await lockHashes(),
    resources: { cpus: 2, memory: '4g', swap: 'disabled', network: 'internal', bind: '127.0.0.1' },
    planned: { detection: frozen.detection.length, policy: frozen.policy.length,
      totalRequests: 2 * (frozen.detection.length + frozen.policy.length) },
    startedAt: new Date().toISOString(), engines: {} };
  const runner = deps.createRunner();
  let failure;
  try {
    for (const name of engines) {
      await runner.withContainer(parsed.images[name], name, async endpoint => {
        if (endpoint.imageId !== imageIds[name]) fail('DOCKER_IMAGE_ID_MISMATCH');
        manifest.engines[name] = { imageId: endpoint.imageId,
          modelPolicyVersion: policyVersions[name], modelVersion: capabilities.engines[name].version,
          dependency: capabilities.engines[name].dependency };
        await ready(endpoint.url, endpoint.signal);
        if (name === 'presidio') {
          const native = await deps.activeRegistry(endpoint.name);
          verifyActivePresidioRegistry(capabilities, native);
          manifest.engines[name].activeRegistry = native;
        }
        const labels = new Set(Object.values(capabilities.engines[name].mapping));
        await smoke(endpoint.url, name, policyVersions[name], labels, endpoint.signal);
        await collectEngine(name, endpoint.url, frozen, bundle, policyVersions[name], endpoint.signal);
      });
    }
  } catch (error) { failure = error; bundle.runStatus = 'incomplete'; }
  manifest.endedAt = new Date().toISOString();
  manifest.runStatus = bundle.runStatus;
  safeEvidence(bundle, frozen);
  await atomicFile(parsed.outputDir, 'results.json', json(bundle));
  await atomicFile(parsed.outputDir, 'run-manifest.json', json(manifest));
  try {
    const summary = await writeReports(parsed.outputDir, bundle, value =>
      deps.validateReleaseBundle(value, frozen));
    if (failure) throw failure;
    return { mode: 'run', status: summary.runStatus };
  } catch (error) {
    if (failure) throw failure;
    throw error;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runFunctional(process.argv.slice(2));
    console.log(result.mode === 'validate' ? `VALIDATED detection=${result.detection} policy=${result.policy} review=${result.reviewStatus} alignment=${result.alignmentStatus}` :
      `REPORT ${result.status.toUpperCase()}`);
    if (result.status === 'incomplete') process.exitCode = 1;
  } catch (error) {
    const allowed = new Set(['INVALID_ARGUMENTS', 'INVALID_CORPUS', 'INVALID_CAPABILITIES',
      'INVALID_BUNDLE', 'OUTPUT_EXISTS', 'OUTPUT_FAILED', 'POLICY_VERSION_UNVERIFIED',
      'DOCKER_IMAGE_ID_MISMATCH', 'UNVERIFIED_PRESIDIO_REGISTRY', 'READINESS_TIMEOUT',
      'SMOKE_FAILED', 'INVALID_RESPONSE', 'INVALID_ANALYZE_REQUEST', 'POLICY_VERSION_MISMATCH',
      'GOLD_REVIEW_PENDING', 'CAPABILITY_ALIGNMENT_PENDING', 'IMAGE_CONFIGURATION_PENDING', 'INTERRUPTED', 'REPORT_CONTAINS_INPUT', 'DOCKER_CLEANUP_FAILED']);
    console.error(allowed.has(error?.message) ? error.message : 'FUNCTIONAL_RUN_FAILED');
    process.exitCode = 1;
  }
}
