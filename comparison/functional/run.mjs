// Functional suite entrypoint. No detector, Docker or corpus work at import time.
import { mkdir, readFile, writeFile, rename, rm } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadCorpus } from './load-corpus.mjs';
import { loadCapabilities, countHorizonTokens, freezeTokenLimits } from './config.mjs';
import { createFunctionalDockerRunner } from './docker-runner.mjs';
import { validateReleaseBundle, analyzeBundle } from './metrics.mjs';
import { renderReport } from './report.mjs';
import { post } from '../http-client.mjs';
import { assertAnalyzeResponse } from '../contract.mjs';
import { createBundle, collectEngine } from './collect.mjs';

const engines = ['presidio', 'horizon'];
const fail = message => { throw new Error(message); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const safeErrors = new Set(['INVALID_ARGUMENTS', 'INVALID_CORPUS', 'INVALID_CAPABILITIES',
  'INVALID_BUNDLE', 'INVALID_TOKEN_COUNT', 'OUTPUT_EXISTS', 'OUTPUT_FAILED', 'GIT_METADATA_FAILED',
  'DOCKER_COMMAND_FAILED', 'DOCKER_INSPECT_FAILED', 'DOCKER_IMAGE_ID_INVALID', 'DOCKER_IMAGE_ID_MISMATCH',
  'DOCKER_NETWORK_INVALID', 'DOCKER_PORT_NOT_LOOPBACK', 'DOCKER_CONTAINER_ID_INVALID',
  'DOCKER_NAME_COLLISION', 'DOCKER_CLEANUP_FAILED', 'READINESS_TIMEOUT', 'SMOKE_FAILED',
  'INVALID_RESPONSE', 'INVALID_ANALYZE_REQUEST', 'POLICY_VERSION_MISMATCH',
  'GOLD_REVIEW_PENDING', 'INTERRUPTED']);
const safeError = error => safeErrors.has(error?.message) ? error.message : 'FUNCTIONAL_RUN_FAILED';

export function parseArguments(args) {
  if (args.length === 1 && args[0] === '--validate-only') return { mode: 'validate' };
  if (args.length === 4 && args[0] === '--render' && args[2] === '--output-dir' &&
      args[1] && args[3] && !args[1].startsWith('--') && !args[3].startsWith('--'))
    return { mode: 'render', results: args[1], outputDir: args[3] };
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
  try {
    await writeFile(temporary, content, { flag: 'wx', mode: 0o600 });
    await rename(temporary, target);
  } catch {
    await rm(temporary, { force: true }).catch(() => {});
    fail('OUTPUT_FAILED');
  }
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
async function ready(url, signal) {
  const deadline = Date.now() + 120000;
  while (!signal.aborted && Date.now() < deadline) {
    try {
      const response = await fetch(`${url}/health/ready`, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(1500)]),
      });
      if (response.status === 200 && (await response.json())?.status === 'ready') return;
      await response.body?.cancel();
    } catch { /* bounded readiness retry, never expose response */ }
    if (signal.aborted) break;
    try { await delay(300, undefined, { signal }); } catch { break; }
  }
  fail(signal.aborted ? 'INTERRUPTED' : 'READINESS_TIMEOUT');
}
async function smoke(url, labels, signal) {
  // Both source HTTP boundaries are unauthenticated. Do not invent an API key.
  // Check only the wire contract, never gate a run on detector accuracy.
  const response = await post(url, JSON.stringify({ fields: [{ fieldId: 'description',
    text: 'Servizio digitale.', allowedEntityTypes: [] }] }), { signal });
  if (response.status !== 200) fail('SMOKE_FAILED');
  assertAnalyzeResponse(response.status, response.body, labels,
    { fieldId: 'description', allowedEntityTypes: [] });
  const version = response.body.modelPolicyVersion;
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]{0,255}$/.test(version)) fail('INVALID_RESPONSE');
  return version;
}
async function writeReports(directory, bundle) {
  const summary = analyzeBundle(bundle);
  const rendered = renderReport(summary);
  for (const [name, text] of Object.entries({ 'summary.json': rendered.summaryJson,
    'sensitivity.csv': rendered.sensitivityCsv, 'verdict.csv': rendered.verdictCsv,
    'report.md': rendered.markdown })) await atomicFile(directory, name, text);
  return summary;
}

/** Dependency injection is for deterministic tests; CLI uses the real adapters. */
export async function runFunctional(args, overrides = {}) {
  const parsed = parseArguments(args);
  const deps = { loadCorpus, loadCapabilities, countTokens: countHorizonTokens,
    createRunner: createFunctionalDockerRunner, gitMetadata, validateReleaseBundle, ...overrides };
  if (parsed.mode === 'render') {
    const bundle = JSON.parse(await readFile(parsed.results, 'utf8'));
    // No current gold, capabilities, models or Docker state is read in render mode.
    deps.validateReleaseBundle(bundle);
    await newOutput(parsed.outputDir);
    const summary = await writeReports(parsed.outputDir, bundle);
    return { mode: 'render', status: summary.runStatus };
  }
  const plan = await deps.loadCorpus();
  const capabilities = await deps.loadCapabilities();
  if (parsed.mode === 'run' && plan.review?.status !== 'independently-reviewed') fail('GOLD_REVIEW_PENDING');
  const frozen = await freezeTokenLimits(plan, deps.countTokens);
  if (parsed.mode === 'validate') return { mode: 'validate', detection: frozen.detection.length,
    policy: frozen.policy.length, reviewStatus: plan.review?.status };
  const bundle = createBundle(frozen, capabilities);
  await newOutput(parsed.outputDir);
  const manifest = { schemaVersion: 1, runId: randomUUID(), runStatus: 'incomplete',
    reviewStatus: plan.review.status, git: deps.gitMetadata(),
    planned: { detection: frozen.detection.length, policy: frozen.policy.length,
      totalRequests: 2 * (frozen.detection.length + frozen.policy.length) },
    startedAt: new Date().toISOString(), engines: {} };
  let failure;
  try {
    const runner = deps.createRunner();
    for (const name of engines) {
      await runner.withContainer(parsed.images[name], name, async endpoint => {
        manifest.engines[name] = { imageId: endpoint.imageId,
          network: endpoint.network, bind: endpoint.bind, modelPolicyVersion: null };
        await ready(endpoint.url, endpoint.signal);
        const labels = new Set(Object.values(capabilities.engines[name].mapping));
        const version = await smoke(endpoint.url, labels, endpoint.signal);
        manifest.engines[name].modelPolicyVersion = version;
        await collectEngine(name, endpoint.url, frozen, bundle, version, endpoint.signal);
      });
    }
  } catch (error) { failure = error; bundle.runStatus = 'incomplete'; }
  manifest.endedAt = new Date().toISOString();
  manifest.runStatus = bundle.runStatus;
  if (failure) manifest.failureCode = safeError(failure);
  try {
    // Validate the exact collected payload before persisting any results or reports.
    deps.validateReleaseBundle(bundle, frozen);
  } catch (error) {
    manifest.runStatus = 'incomplete';
    manifest.failureCode = safeError(error);
    await atomicFile(parsed.outputDir, 'run-manifest.json', json(manifest));
    throw new Error(safeError(error));
  }
  let summary;
  try {
    await atomicFile(parsed.outputDir, 'run-manifest.json', json(manifest));
    await atomicFile(parsed.outputDir, 'results.json', json(bundle));
    summary = await writeReports(parsed.outputDir, bundle);
  } catch (error) {
    manifest.runStatus = 'incomplete';
    manifest.failureCode = safeError(error);
    await atomicFile(parsed.outputDir, 'run-manifest.json', json(manifest)).catch(() => {});
    throw new Error(safeError(error));
  }
  if (failure) throw new Error(safeError(failure));
  return { mode: 'run', status: summary.runStatus };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const result = await runFunctional(process.argv.slice(2));
    console.log(result.mode === 'validate' ? `VALIDATED detection=${result.detection} policy=${result.policy} review=${result.reviewStatus}` :
      `REPORT ${result.status.toUpperCase()}`);
    if (result.status === 'incomplete') process.exitCode ||= 1;
  } catch (error) {
    console.error(safeError(error));
    process.exitCode ||= 1;
  }
}
