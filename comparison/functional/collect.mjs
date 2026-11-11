// HTTP-only adapter: never persist request text or raw response bodies.
import { TARGET_CATEGORIES, FIELD_IDS } from '../catalog.mjs';
import { nativeToGold, expandAllowlist, validateCategoryMap } from './category-map.mjs';
import { requestFor, assertAnalyzeResponse } from '../contract.mjs';
import { post } from '../http-client.mjs';

const engines = ['presidio', 'horizon'];
const probes = ['detection', 'policy'];
const categories = new Set(TARGET_CATEGORIES);

const fields = new Set(FIELD_IDS);
const safeId = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const safeFamily = x => typeof x === 'string' && /^[a-z][a-z0-9_-]{0,127}$/.test(x);
const safeList = (xs, valid) => Array.isArray(xs) && xs.every(valid) && new Set(xs).size === xs.length;
const optional = (value, valid) => value === undefined || valid(value);
const annotationValues = {
  target: ['declared-category-presence'], form: ['plausible', 'absent-or-malformed'],
  checksum: ['not_checked', 'luhn_pass', 'vat_check_digit_pass', 'vat_check_digit_fail',
    'iban_mod97_pass', 'iban_mod97_fail', 'cf_checksum_pass', 'cf_checksum_fail', 'luhn_fail'], assignment: ['not_checked'],
  domesticCin: ['not_checked'],
};
const safeAnnotation = a => a !== null && typeof a === 'object' && !Array.isArray(a) &&
  Object.entries(a).every(([key, value]) => key === 'rationale' ?
    typeof value === 'string' : Object.hasOwn(annotationValues, key) && annotationValues[key].includes(value));
// Validate the literal spelling, not URL-normalized variants (userinfo, paths, escapes).
const loopbackUrl = value => {
  if (typeof value !== 'string') return false;
  const match = /^http:\/\/127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(value);
  return !!match && Number(match[1]) <= 65535;
};
const safeMetadata = s => s !== null && typeof s === 'object' &&
  safeId(s.id) && fields.has(s.fieldId) &&
  safeList(s.expectedEntities, x => categories.has(x)) &&
  optional(s.allowedEntityTypes, x => safeList(x, y => categories.has(y))) &&
  optional(s.expectedVerdict, x => ['accepted', 'rejected'].includes(x)) &&
  optional(s.split, x => ['development', 'evaluation'].includes(x)) &&
  optional(s.familyId, safeFamily) && optional(s.scenario, safeId) &&
  optional(s.focusCategory, x => categories.has(x)) &&
  optional(s.focusPolarity, x => ['positive', 'negative'].includes(x)) &&
  optional(s.provenanceId, safeId) &&
  optional(s.annotationStatus, x => ['pending', 'independently-reviewed'].includes(x)) &&
  optional(s.limitChallenge, x => typeof x === 'boolean') &&
  optional(s.tokenCount, x => Number.isSafeInteger(x) && x >= 0);
const safeStratum = s => s !== null && typeof s === 'object' && safeId(s.sourceId) &&
  optional(s.fieldId, x => fields.has(x)) && optional(s.provenanceId, safeId) &&
  optional(s.allowedEntityTypes, x => safeList(x, y => categories.has(y))) &&
  optional(s.expectedVerdict, x => ['accepted', 'rejected'].includes(x)) &&
  categories.has(s.focusCategory) && optional(s.focusPolarity, x => ['positive', 'negative'].includes(x)) &&
  safeId(s.scenario) && optional(s.annotation, safeAnnotation);
const safeCapabilities = c => c?.engines && engines.every(name => {
  const engine = c.engines[name];
  return engine?.mapping && engine?.capabilities &&
    Object.keys(engine.mapping).length === Object.keys(nativeToGold[name]).length &&
    Object.entries(nativeToGold[name]).every(([native, label]) => engine.mapping[native] === label) &&
    Object.keys(engine.capabilities).every(category => categories.has(category));
});
const validateConfig = (plan, capabilities, urls, policyVersions) => {
  try {
    if (!Array.isArray(plan?.detection) || !Array.isArray(plan?.policy) ||
      !safeCapabilities(capabilities) || !engines.every(name =>
        loopbackUrl(urls?.[name]) && typeof policyVersions?.[name] === 'string' &&
        policyVersions[name].length > 0) ||
      !plan.detection.every(d => safeId(d?.detectionCaseId) &&
        safeList(d.sourceIds, safeId) && d.sourceIds.length > 0 &&
        safeMetadata({ ...d, id: d.detectionCaseId }) &&
        Array.isArray(d.strata) && d.strata.every(safeStratum)) ||
      !plan.policy.every(p => safeMetadata(p) &&
        safeList(p.allowedEntityTypes, x => categories.has(x)) &&
        ['accepted', 'rejected'].includes(p.expectedVerdict))) fail('INVALID_COLLECTION_CONFIG');
  } catch { fail('INVALID_COLLECTION_CONFIG'); }
};
const fail = (message, bundle) => {
  const error = new Error(message);
  if (bundle) { bundle.runStatus = 'incomplete'; error.bundle = bundle; }
  throw error;
};

export function createBundle(plan, capabilities) {
  validateCategoryMap(nativeToGold);
  const bySource = new Map();
  const detectionUnits = plan.detection.map(unit => {
    for (const id of unit.sourceIds) bySource.set(id, unit.detectionCaseId);
    return { id: unit.detectionCaseId, sourceIds: [...unit.sourceIds], fieldId: unit.fieldId,
      expectedEntities: [...unit.expectedEntities], split: unit.split, familyId: unit.familyId,
      strata: unit.strata.map(stratum => ({ sourceId: stratum.sourceId, fieldId: stratum.fieldId,
        provenanceId: stratum.provenanceId, allowedEntityTypes: stratum.allowedEntityTypes,
        expectedVerdict: stratum.expectedVerdict, focusCategory: stratum.focusCategory,
        focusPolarity: stratum.focusPolarity, scenario: stratum.scenario,
        ...(stratum.annotation ? { annotation: Object.fromEntries(
          ['target', 'form', 'checksum', 'assignment', 'domesticCin'].filter(k =>
            Object.hasOwn(stratum.annotation, k)).map(k => [k, stratum.annotation[k]])) } : {}) })),
      tokenCount: unit.tokenCount, limitChallenge: unit.limitChallenge };
  });
  const policyUnits = plan.policy.map(unit => ({ id: unit.id,
    detectionCaseId: bySource.get(unit.id), fieldId: unit.fieldId,
    expectedEntities: [...unit.expectedEntities], allowedEntityTypes: [...unit.allowedEntityTypes],
    nativeAllowedEntityTypes: Object.fromEntries(engines.map(name =>
      [name, expandAllowlist(name, unit.allowedEntityTypes)])),
    expectedVerdict: unit.expectedVerdict, split: unit.split, familyId: unit.familyId,
    scenario: unit.scenario, focusCategory: unit.focusCategory,
    focusPolarity: unit.focusPolarity, provenanceId: unit.provenanceId,
    annotationStatus: unit.annotationStatus, tokenCount: unit.tokenCount,
    limitChallenge: unit.limitChallenge }));
  return { schemaVersion: 2, runStatus: 'complete',
    capabilities: { categories: [...TARGET_CATEGORIES], engines: Object.fromEntries(engines.map(name =>
      [name, { supportedCategories: Object.keys(capabilities.engines[name].capabilities),
        mapping: { ...nativeToGold[name] } }])) },
    detectionUnits, policyUnits,
    observations: Object.fromEntries(engines.map(name => [name, { detection: {}, policy: {} }])) };
}
export async function collectEngine(name, endpoint, plan, bundle, version, signal, timeoutMs = 30000) {
  const labels = new Set(Object.keys(bundle.capabilities.engines[name].mapping));
  for (const [probe, units] of [['detection', plan.detection], ['policy', plan.policy]]) {
    for (const unit of units) {
      if (signal?.aborted) fail('INTERRUPTED', bundle);
      const id = probe === 'detection' ? unit.detectionCaseId : unit.id;
      const allowed = probe === 'detection' ? [] : expandAllowlist(name, unit.allowedEntityTypes);
      let response;
      try {
        response = await post(endpoint, JSON.stringify(requestFor(unit, allowed)), { signal, timeoutMs });
        if (response.status) assertAnalyzeResponse(response.status, response.body, labels,
          { fieldId: unit.fieldId, allowedEntityTypes: allowed });
      } catch (error) {
        const interrupted = error.message === 'INTERRUPTED';
        bundle.observations[name][probe][id] = { status: interrupted ? 'transport-error' : 'contract-error' };
        bundle.runStatus = 'incomplete';
        fail(interrupted ? 'INTERRUPTED' : 'INVALID_RESPONSE');
      }
      if (response.status === 0 || response.status === 503) {
        bundle.observations[name][probe][id] = { status: response.status === 0 ? 'transport-error' : 503 };
        bundle.runStatus = 'incomplete';
      } else if (response.status === 400) {
        bundle.observations[name][probe][id] = { status: 'contract-error' };
        bundle.runStatus = 'incomplete';
        fail('INVALID_ANALYZE_REQUEST');
      } else {
        if (response.body.modelPolicyVersion !== version) {
          bundle.observations[name][probe][id] = { status: 'contract-error' };
          bundle.runStatus = 'incomplete';
          fail('POLICY_VERSION_MISMATCH');
        }
        bundle.observations[name][probe][id] = { status: 200,
          categories: [...new Set(response.body.findings.map(f => f.entityType))],
          verdict: response.body.verdict };
      }
    }
  }
}

/** Both the orchestrator and HTTP-only adapter use the same collector. */
export async function collectBundle({ plan, capabilities, urls, policyVersions, timeoutMs = 30000, signal } = {}) {
  validateConfig(plan, capabilities, urls, policyVersions);
  const bundle = createBundle(plan, capabilities);
  try {
    for (const name of engines) await collectEngine(name, urls[name], plan, bundle, policyVersions[name], signal, timeoutMs);
  } catch (error) { bundle.runStatus = 'incomplete'; error.bundle = bundle; throw error; }
  return bundle;
}
