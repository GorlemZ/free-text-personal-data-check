import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { TARGET_CATEGORIES } from '../catalog.mjs';
import { LABEL_MAP } from '../../poc-horizon/src/categories.mjs';

const fail = () => { throw new Error('INVALID_CAPABILITIES'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const same = (a, b) => a.length === b.length && new Set(a).size === a.length &&
  a.every(x => b.includes(x));
const rules = ['IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE'];
export function validateCapabilities(data) {
  if (!object(data) || data.schemaVersion !== 1 || data.frozenBeforePredictions !== true ||
      !same(data.sampledCategories ?? [], TARGET_CATEGORIES) || data.unsampledCategories?.length !== 0 ||
      !['pending', 'independently-reviewed'].includes(data.alignmentStatus) ||
      !object(data.engines) || !same(Object.keys(data.engines), ['presidio', 'horizon'])) fail();
  const expected = { presidio: Object.fromEntries(TARGET_CATEGORIES.map(x => [x,x])),
    horizon: { ...LABEL_MAP, ...Object.fromEntries(rules.map(x => [x,x])) } };
  for (const [name, engine] of Object.entries(data.engines)) {
    if (!object(engine) || typeof engine.version !== 'string' || !engine.version ||
        !/^sha256:[a-f0-9]{64}$/.test(engine.expectedImageId ?? '') && engine.expectedImageId !== null ||
        typeof engine.dependency !== 'string' || !engine.dependency ||
        typeof engine.configuration !== 'string' || !engine.configuration ||
        !object(engine.mapping) || !same(Object.keys(engine.mapping), Object.keys(expected[name])) ||
        Object.entries(expected[name]).some(([k,v]) => engine.mapping[k] !== v) ||
        !object(engine.capabilities) || !same(Object.keys(engine.capabilities), TARGET_CATEGORIES)) fail();
    for (const cap of Object.values(engine.capabilities)) if (!object(cap) ||
      typeof cap.scope !== 'string' || !cap.scope || typeof cap.checksum !== 'string' || !cap.checksum ||
      !Array.isArray(cap.evidence) || !cap.evidence.length ||
      cap.evidence.some(x => typeof x !== 'string' || !x || x.includes('..'))) fail();
  }
  return data;
}
export async function loadCapabilities(directory = new URL('./', import.meta.url),
  manifestUrl = new URL('../manifest.json', directory)) {
  const bytes = await readFile(new URL('capabilities.json', directory));
  const manifest = JSON.parse(await readFile(manifestUrl));
  const artifactSha256 = createHash('sha256').update(bytes).digest('hex');
  if (manifest.capabilitiesSha256 !== artifactSha256) fail();
  return { ...validateCapabilities(JSON.parse(bytes)), artifactSha256 };
}

// Caller must obtain this inventory from get_analyzer().get_supported_entities(language='it').
// Declared YAML and native mappings are not evidence that recognizers loaded in this run.
export function verifyActivePresidioRegistry(capabilities, activeNativeTypes) {
  const expected = Object.keys(capabilities?.engines?.presidio?.mapping ?? {});
  if (!Array.isArray(activeNativeTypes) || !expected.length ||
      new Set(activeNativeTypes).size !== activeNativeTypes.length ||
      !same(activeNativeTypes, expected))
    throw new Error('UNVERIFIED_PRESIDIO_REGISTRY');
  return [...activeNativeTypes];
}

// Local tokenizer assets only: never load the model weights or run detector inference.
let localTokenizer;
export async function countHorizonTokens(text, options = { truncation: false, padding: false }) {
  if (typeof text !== 'string' || options?.truncation !== false || options?.padding !== false)
    throw new Error('INVALID_TOKEN_COUNT');
  localTokenizer ??= (async () => {
    const { AutoTokenizer, env } = await import(new URL('../../poc-horizon/node_modules/@huggingface/transformers/dist/transformers.node.mjs', import.meta.url));
    env.allowRemoteModels = false;
    env.allowLocalModels = true;
    const path = fileURLToPath(new URL('../../poc-horizon/models/Horizon-Labs/pii-redactor-base/', import.meta.url));
    return AutoTokenizer.from_pretrained(path, { local_files_only: true });
  })().catch(error => { localTokenizer = undefined; throw error; });
  const tokenizer = await localTokenizer;
  return tokenizer(text, { truncation: false, padding: false }).input_ids.size;
}

// countTokens must use the local Horizon tokenizer with truncation:false and padding:false.
// No model inference or service request is made by this preflight.
export async function freezeTokenLimits(plan, countTokens) {
  if (!Array.isArray(plan?.detection) || !Array.isArray(plan?.policy) ||
      typeof countTokens !== 'function') throw new Error('INVALID_TOKEN_COUNT');
  const counts = new Map();
  const detection = [];
  for (const sample of plan.detection) {
    const count = await countTokens(sample.text, { truncation: false, padding: false });
    if (!Number.isSafeInteger(count) || count < 0) throw new Error('INVALID_TOKEN_COUNT');
    counts.set(sample.detectionCaseId, count);
    detection.push({ ...sample, tokenCount: count, limitChallenge: count > 512 });
  }
  const sourceCounts = new Map(detection.flatMap(d => d.sourceIds.map(id => [id, d.tokenCount])));
  if (sourceCounts.size !== plan.policy.length ||
      plan.policy.some(p => !sourceCounts.has(p.id))) throw new Error('INVALID_TOKEN_COUNT');
  return { ...plan, detection, policy: plan.policy.map(p => ({ ...p,
    tokenCount: sourceCounts.get(p.id), limitChallenge: sourceCounts.get(p.id) > 512 })) };
}
