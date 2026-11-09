// Black-box comparison: synthetic corpus only, no raw inputs or responses in output.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { CATEGORIES as horizonCategories } from '../poc-horizon/src/categories.mjs';
import { FIELD_IDS, HORIZON_SUPPORTED, TARGET_CATEGORIES } from './catalog.mjs';
import { requestFor, assertAnalyzeResponse } from './contract.mjs';
import { analyzeResults, validateCorpus } from './metrics.mjs';
import { ContainerTracker } from './docker-lifecycle.mjs';
import { post as postHttp } from './http-client.mjs';

const base = dirname(fileURLToPath(import.meta.url));
const images = [
  { name: 'spacy', image: 'free-text-check:spacy-poc', categories: new Set(TARGET_CATEGORIES),
    supported: new Set(TARGET_CATEGORIES) },
  { name: 'horizon', image: 'free-text-check:horizon-poc', categories: horizonCategories,
    supported: HORIZON_SUPPORTED },
];
const abort = new AbortController();
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  abort.abort();
  try { tracker.stopAll(); process.exitCode = signal === 'SIGINT' ? 130 : 143; }
  catch { process.exitCode = 1; }
});
function docker(args, ignoreFailure = false) {
  const r = spawnSync('docker', args, { encoding: 'utf8', timeout: 180000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  if (r.status !== 0 && !ignoreFailure) throw new Error('DOCKER_COMMAND_FAILED');
  return r.stdout?.trim() ?? '';
}
const tracker = new ContainerTracker(docker);
function start(image) {
  const name = `poc-comparison-${randomUUID().slice(0, 12)}`;
  tracker.track(name); // Docker may create the container before returning an ID.
  const id = docker(['run', '-d', '--rm', '--name', name,
    '--memory=4g', '--memory-swap=4g', '--cpus=2',
    '-e', 'ANALYZER_BIND_HOST=0.0.0.0',
    '-e', 'HF_HUB_OFFLINE=1', '-e', 'TRANSFORMERS_OFFLINE=1',
    '-p', '127.0.0.1::8000', image]);
  if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('DOCKER_CONTAINER_ID_INVALID');
  const port = docker(['port', id, '8000/tcp']).match(/^127\.0\.0\.1:(\d+)$/m)?.[1];
  if (!port) throw new Error('DOCKER_PORT_NOT_LOOPBACK');
  return { name, url: `http://127.0.0.1:${port}` };
}
async function ready(url) {
  const end = Date.now() + 120000;
  while (!abort.signal.aborted && Date.now() < end) {
    try {
      const r = await fetch(`${url}/health/ready`, { signal: AbortSignal.any([
        abort.signal, AbortSignal.timeout(1500) ]) });
      if (r.status === 200 && (await r.json()).status === 'ready') return;
    } catch { /* readiness is bounded above */ }
    await delay(300, undefined, { signal: abort.signal });
  }
  throw new Error('READINESS_TIMEOUT');
}
const post = (url, payload, timeoutMs = 30000) => postHttp(url, payload,
  { timeoutMs, signal: abort.signal });
function check(response, categories, options) {
  if (response.status === 0) return;
  assertAnalyzeResponse(response.status, response.body, categories, options);
}
function percentile(numbers, pct) {
  if (!numbers.length) return null;
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.ceil(pct * sorted.length) - 1];
}
function timing(responses) {
  return { n: responses.length, completed: responses.filter(x => x.status === 200).length,
    errors: responses.filter(x => x.status !== 200).length,
    p50Ms: percentile(responses.map(x => x.ms), 0.5),
    p95Ms: percentile(responses.map(x => x.ms), 0.95) };
}
async function exercise(url, categories, name) {
  const field = (fieldId, text = 'Servizio digitale.') => ({ fieldId, text,
    allowedEntityTypes: [] });
  const invalids = [
    { fields: [field('description'), field('description')] },
    { fields: Array.from({ length: 17 }, () => field('description')) },
    { fields: [field('description', 'x'.repeat(33000))] },
  ];
  const checks = {};
  for (const [index, payload] of invalids.entries()) {
    const response = await post(url, JSON.stringify(payload));
    check(response, categories);
    if (response.status !== 400) throw new Error('INVALID_REQUEST_ACCEPTED');
    checks[['duplicateField', 'seventeenFieldsWithDuplicates', 'oversizedBody'][index]] = 400;
  }
  const malformed = await post(url, Buffer.concat([Buffer.from('{"fields":[{"fieldId":"description","text":"'),
    Buffer.from([0xff]), Buffer.from('","allowedEntityTypes":[]}]}')]));
  check(malformed, categories);
  if (malformed.status !== 400) throw new Error('INVALID_UTF8_ACCEPTED');
  checks.invalidUtf8 = 400;
  if (name === 'horizon') {
    const long = await post(url, JSON.stringify({ fields: [field('description', 'a '.repeat(750))] }));
    check(long, categories);
    if (long.status !== 503) throw new Error('TOKEN_BUDGET_NOT_ENFORCED');
    checks.over512Tokens = 503;
  }
  const bulk = await post(url, JSON.stringify({ fields: FIELD_IDS.map(x => field(x)) }), 120000);
  check(bulk, categories);
  if (bulk.status !== 200) throw new Error('BULK_FAILED');
  checks.bulk = { nFields: FIELD_IDS.length, durationMs: bulk.ms, status: bulk.status };
  const burst = await Promise.all(Array.from({ length: 8 }, () =>
    post(url, JSON.stringify({ fields: [field('description')] }), 120000)));
  for (const response of burst) check(response, categories);
  checks.burst = { ...timing(burst), statuses: burst.reduce((acc, x) => {
    acc[x.status] = (acc[x.status] ?? 0) + 1; return acc;
  }, {}) };
  return checks;
}
async function compare(config, samples) {
  const imageId = docker(['image', 'inspect', config.image, '--format', '{{.Id}}']);
  if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('DOCKER_IMAGE_ID_INVALID');
  let container;
  try {
    container = start(config.image);
    await ready(container.url);
    const first = await post(container.url, JSON.stringify(requestFor(samples[0], [])));
    check(first, config.categories, { fieldId: samples[0].fieldId });
    if (first.status !== 200) throw new Error('COLD_REQUEST_FAILED');
    const warm = [];
    for (let i = 0; i < 5; i++) {
      const r = await post(container.url, JSON.stringify(requestFor(samples[0], [])));
      check(r, config.categories, { fieldId: samples[0].fieldId });
      warm.push(r);
    }
    const results = [];
    let policyVersion = first.body.modelPolicyVersion;
    for (const sample of samples) {
      const detector = await post(container.url, JSON.stringify(requestFor(sample, [])));
      const policy = await post(container.url, JSON.stringify(requestFor(sample)));
      for (const [response, allowedEntityTypes] of [[detector, []],
        [policy, sample.allowedEntityTypes]]) {
        check(response, config.categories, { fieldId: sample.fieldId, allowedEntityTypes });
        if (response.status === 200 && response.body.modelPolicyVersion !== policyVersion)
          throw new Error('POLICY_VERSION_MISMATCH');
      }
      results.push({ id: sample.id, detector, policy });
    }
    const metrics = analyzeResults(samples, results, config.supported);
    const lookup = id => results.find(x => x.id === id)?.detector;
    const neutral = lookup('neutral');
    const email = lookup('email-positive');
    if (neutral?.status !== 200 || neutral.body.verdict !== 'accepted' ||
      email?.status !== 200 || !email.body.findings.some(x => x.entityType === 'EMAIL_ADDRESS') ||
      (config.name === 'horizon' && !lookup('cf-positive')?.body?.findings.some(
        x => x.entityType === 'IT_FISCAL_CODE'))) throw new Error('MINIMUM_CASE_FAILED');
    const checks = await exercise(container.url, config.categories, config.name);
    return { engine: config.name, imageId, modelPolicyVersion: policyVersion,
      metrics, latency: { cold: timing([first]), warm: timing(warm),
        corpusRequests: timing(results.flatMap(x => [x.detector, x.policy])) }, checks };
  } finally { if (container) tracker.stop(container.name); }
}
try {
  const corpus = JSON.parse(await readFile(resolve(base, 'corpus.json'), 'utf8'));
  validateCorpus(corpus);
  const reports = [];
  for (const config of images) reports.push(await compare(config, corpus));
  const report = { schemaVersion: 1, corpusSamples: corpus.length,
    engines: reports, limitations: ['synthetic-only', 'no-production-claim',
      'unsupported-horizon-categories-excluded-from-detection-matrix',
      'container-concurrency-observational-not-an-sla'] };
  const json = JSON.stringify(report);
  if (corpus.some(sample => json.includes(sample.text))) throw new Error('REPORT_CONTAINS_INPUT');
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  // Never echo a raw exception: it may contain a request or response body.
  const allowed = new Set(['INVALID_CORPUS', 'INVALID_RESULTS', 'INVALID_RESPONSE',
    'DOCKER_COMMAND_FAILED', 'DOCKER_CLEANUP_FAILED', 'DOCKER_CONTAINER_ID_INVALID',
    'DOCKER_CONTAINER_NAME_INVALID', 'DOCKER_PORT_NOT_LOOPBACK',
    'DOCKER_IMAGE_ID_INVALID', 'READINESS_TIMEOUT', 'INTERRUPTED',
    'INVALID_REQUEST_ACCEPTED', 'INVALID_UTF8_ACCEPTED', 'TOKEN_BUDGET_NOT_ENFORCED',
    'BULK_FAILED', 'COLD_REQUEST_FAILED', 'POLICY_VERSION_MISMATCH', 'MINIMUM_CASE_FAILED',
    'REPORT_CONTAINS_INPUT']);
  console.error(allowed.has(error.message) ? error.message : 'COMPARISON_FAILED');
  process.exitCode = 1;
} finally {
  try { tracker.stopAll(); }
  catch { console.error('DOCKER_CLEANUP_FAILED'); process.exitCode = 1; }
}
