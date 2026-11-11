// Pure, sanitized functional-suite aggregation; no corpus or detector imports.
import { TARGET_CATEGORIES, FIELD_IDS } from '../catalog.mjs';
import { nativeToGold, projectFindings } from './category-map.mjs';

const fail = () => { throw new Error('INVALID_BUNDLE'); };
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const uniqueStrings = x => Array.isArray(x) && x.every(v => typeof v === 'string' && v.length) && new Set(x).size === x.length;
const engines = ['presidio', 'horizon'];
const probes = ['detection', 'policy'];
const same = (a, b) => a.length === b.length && a.every(v => b.includes(v));
const safeId = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
// Historical bundles retain their original catalog; only standalone render accepts it.
const historicalCategories = ['PERSON', 'ORGANIZATION', 'LOCATION', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
  'CREDIT_CARD', 'IP_ADDRESS', 'MAC_ADDRESS', 'URL', 'IT_FISCAL_CODE', 'IT_DRIVER_LICENSE',
  'IT_IDENTITY_CARD', 'IT_PASSPORT', 'IT_VAT_CODE', 'IBAN_CODE', 'CRYPTO', 'DATE_TIME', 'MEDICAL_LICENSE'];
const historicalHorizon = historicalCategories.filter(c => ![
  'IT_DRIVER_LICENSE', 'IT_IDENTITY_CARD', 'IT_PASSPORT', 'CRYPTO', 'DATE_TIME', 'MEDICAL_LICENSE'].includes(c));
// Read-only v1 vocabulary. Never import the live service mapping for historical bundles.
const legacyHorizon = Object.fromEntries(['ACCOUNT_ID','AGE','BANK_ACCOUNT','COORDINATE','CREDIT_CARD',
  'CREDIT_CARD_CVV','DATE','DATE_OF_BIRTH','DEVICE_ID','DRIVER_LICENSE','IP_ADDRESS',
  'LICENSE_NUMBER','LOCATION','MAC_ADDRESS','MEDICAL_ID','NATIONAL_ID','ORGANIZATION','PASSPORT',
  'PASSWORD','PERSON','POSTCODE','SECRET','STREET_ADDRESS','TAX_ID','URL','USERNAME','VEHICLE_ID',
  'IT_FISCAL_CODE','IT_VAT_CODE','IBAN_CODE'].map(c => [c,c]));
legacyHorizon.EMAIL = 'EMAIL_ADDRESS'; legacyHorizon.PHONE = 'PHONE_NUMBER';
const nativeCategories = {
  presidio: new Set([...historicalCategories, 'NRP']),
  horizon: new Set([...Object.values(legacyHorizon), 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']),
};
// Frozen schema-2 *reader* contract, independent of the live collector map.
// Snapshot values still drive projection, but may not redefine wire semantics.
const v2ReadCategories = Object.freeze(['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
  'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD',
  'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']);
const v2ReadMapping = Object.freeze({
  presidio: Object.freeze(Object.fromEntries(v2ReadCategories.map(category => [category, category]))),
  horizon: Object.freeze({ PERSON: 'PERSON', EMAIL: 'EMAIL_ADDRESS', PHONE: 'PHONE_NUMBER',
    PHONE_NUMBER: 'PHONE_NUMBER', IT_FISCAL_CODE: 'IT_FISCAL_CODE', IT_VAT_CODE: 'IT_VAT_CODE',
    IBAN_CODE: 'IBAN_CODE', CREDIT_CARD: 'CREDIT_CARD', NATIONAL_ID: 'IT_IDENTITY_CARD',
    DRIVER_LICENSE: 'IT_DRIVER_LICENSE' }),
});
const projectedCatalogs = new WeakMap();
const keys = (value, required, optional = []) => object(value) &&
  required.every(k => Object.hasOwn(value, k)) &&
  Object.keys(value).every(k => required.includes(k) || optional.includes(k));
const optional = (value, valid) => value === undefined || valid(value);
const safeFamily = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,127}$/.test(value);
const metadataKeys = ['split', 'familyId', 'scenario', 'focusCategory', 'focusPolarity',
  'provenanceId', 'annotationStatus', 'tokenCount', 'limitChallenge'];
const metadataValid = (unit, catalog) =>
  optional(unit.split, x => ['development', 'evaluation'].includes(x)) && optional(unit.familyId, safeFamily) &&
  optional(unit.scenario, safeId) && optional(unit.focusCategory, x => catalog.has(x)) &&
  optional(unit.focusPolarity, x => ['positive', 'negative'].includes(x)) &&
  optional(unit.provenanceId, safeId) &&
  optional(unit.annotationStatus, x => ['pending', 'independently-reviewed'].includes(x)) &&
  optional(unit.tokenCount, x => Number.isSafeInteger(x) && x >= 0) &&
  optional(unit.limitChallenge, x => typeof x === 'boolean');
const annotationValues = {
  target: ['declared-category-presence'], form: ['plausible', 'absent-or-malformed'],
  checksum: ['not_checked', 'luhn_pass', 'luhn_fail', 'vat_check_digit_pass', 'vat_check_digit_fail',
    'iban_mod97_pass', 'iban_mod97_fail', 'cf_checksum_pass', 'cf_checksum_fail'],
  assignment: ['not_checked'], domesticCin: ['not_checked'],
};
const annotationValid = a => keys(a, [], Object.keys(annotationValues)) &&
  Object.entries(a).every(([k, v]) => annotationValues[k].includes(v));
function validateSafeShape(bundle) {
  if (!keys(bundle, ['schemaVersion', 'runStatus', 'capabilities', 'detectionUnits', 'policyUnits', 'observations']) ||
      !keys(bundle.capabilities, ['categories', 'engines']) ||
      !uniqueStrings(bundle.capabilities.categories) ||
      !keys(bundle.capabilities.engines, engines) || !keys(bundle.observations, engines) ||
      !Array.isArray(bundle.detectionUnits) || !Array.isArray(bundle.policyUnits)) fail();
  const catalog = new Set(bundle.capabilities.categories);
  for (const engine of engines) {
    const cap = bundle.capabilities.engines[engine];
    if (!keys(cap, ['supportedCategories'], ['mapping']) || !keys(bundle.observations[engine], probes)) fail();
    if (cap.mapping !== undefined && (!object(cap.mapping) || Object.entries(cap.mapping).some(([native, label]) =>
      engine === 'presidio' ? native !== label || !nativeCategories.presidio.has(label) :
        legacyHorizon[native] !== label))) fail();
  }
  for (const unit of bundle.detectionUnits) {
    if (!keys(unit, ['id', 'sourceIds', 'fieldId', 'expectedEntities'], [...metadataKeys, 'strata']) ||
        !metadataValid(unit, catalog)) fail();
    if (unit.strata !== undefined) {
      if (!Array.isArray(unit.strata)) fail();
      for (const s of unit.strata) {
        if (!keys(s, ['sourceId', 'focusCategory', 'scenario'],
          ['fieldId', 'provenanceId', 'allowedEntityTypes', 'expectedVerdict', 'focusPolarity', 'annotation']) ||
          !metadataValid(s, catalog) || !optional(s.fieldId, x => FIELD_IDS.includes(x)) ||
          !optional(s.allowedEntityTypes, x => uniqueStrings(x) && x.every(c => catalog.has(c))) ||
          !optional(s.expectedVerdict, x => ['accepted', 'rejected'].includes(x)) ||
          !optional(s.annotation, annotationValid)) fail();
      }
    }
  }
  for (const unit of bundle.policyUnits) if (!keys(unit,
    ['id', 'detectionCaseId', 'fieldId', 'expectedEntities', 'allowedEntityTypes', 'expectedVerdict'], metadataKeys) ||
    !metadataValid(unit, catalog)) fail();
}
const verifiedSummaries = new WeakMap();
export const isVerifiedSummary = summary => summary !== null && typeof summary === 'object' &&
  verifiedSummaries.has(summary) && verifiedSummaries.get(summary) === JSON.stringify(summary);
const empty = () => ({ tp: 0, fn: 0, fp: 0, tn: 0 });
const ratio = (numerator, denominator) => denominator ? numerator / denominator : null;
const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
const sum = (a, b) => Object.fromEntries(Object.keys(a).map(k => [k, a[k] + b[k]]));
const score = c => {
  const recall = ratio(c.tp, c.tp + c.fn);
  const specificity = ratio(c.tn, c.tn + c.fp);
  return { counts: c, positive: c.tp + c.fn, negative: c.fp + c.tn,
    recall, precision: ratio(c.tp, c.tp + c.fp), specificity,
    f1: ratio(2 * c.tp, 2 * c.tp + c.fp + c.fn),
    accuracy: ratio(c.tp + c.tn, c.tp + c.fn + c.fp + c.tn),
    balancedAccuracy: recall === null || specificity === null ? null : (recall + specificity) / 2 };
};
const tally = (c, expected, observed) => { c[expected ? (observed ? 'tp' : 'fn') : (observed ? 'fp' : 'tn')]++; };
const statusKind = o => o === undefined || o?.status === 'unattempted' ? 'unattempted' :
  o?.status === 200 ? 'success' : [400, 'contract-error'].includes(o?.status) ? 'contract' :
  [503, 'timeout', 'transport-error', 'crash'].includes(o?.status) ? 'technical' : fail();

// V2 validates the native wire evidence before projecting it into the existing
// category-presence scorer. A v1 bundle never enters this path.
function projectV2(bundle) {
  if (!keys(bundle, ['schemaVersion','runStatus','capabilities','detectionUnits','policyUnits','observations']) ||
      !keys(bundle.capabilities, ['categories','engines']) ||
      !uniqueStrings(bundle.capabilities.categories) || !same(bundle.capabilities.categories, v2ReadCategories) ||
      bundle.capabilities.categories.some(c => !/^[A-Z][A-Z0-9_]{0,63}$/.test(c)) ||
      !keys(bundle.capabilities.engines, engines) || !keys(bundle.observations, engines) ||
      !Array.isArray(bundle.policyUnits) || !Array.isArray(bundle.detectionUnits)) fail();
  const mapping = {};
  for (const engine of engines) {
    const cap = bundle.capabilities.engines[engine];
    if (!keys(cap, ['supportedCategories','mapping']) || !uniqueStrings(cap.supportedCategories) ||
        !same(cap.supportedCategories, bundle.capabilities.categories) || !object(cap.mapping) ||
        Object.keys(cap.mapping).length === 0 ||
        Object.entries(cap.mapping).some(([label, gold]) =>
          !/^[A-Z][A-Z0-9_]{0,63}$/.test(label) || !bundle.capabilities.categories.includes(gold)) ||
        !same([...new Set(Object.values(cap.mapping))], bundle.capabilities.categories) ||
        !same(Object.keys(cap.mapping), Object.keys(v2ReadMapping[engine])) ||
        Object.entries(v2ReadMapping[engine]).some(([label, gold]) => cap.mapping[label] !== gold) ||
        !keys(bundle.observations[engine], probes)) fail();
    mapping[engine] = cap.mapping;
  }
  for (const unit of bundle.policyUnits) {
    if (!keys(unit, ['id','detectionCaseId','fieldId','expectedEntities','allowedEntityTypes',
      'nativeAllowedEntityTypes','expectedVerdict'], metadataKeys) ||
      !keys(unit.nativeAllowedEntityTypes, engines) ||
      !uniqueStrings(unit.allowedEntityTypes) ||
      unit.allowedEntityTypes.some(category => !bundle.capabilities.categories.includes(category))) fail();
    for (const engine of engines) {
      const native = unit.nativeAllowedEntityTypes[engine];
      const expected = Object.entries(mapping[engine]).filter(([,gold]) =>
        unit.allowedEntityTypes.includes(gold)).map(([label]) => label);
      if (!uniqueStrings(native) || !same(native, expected)) fail();
    }
  }
  for (const engine of engines) for (const probe of probes) {
    const observations = bundle.observations[engine][probe];
    if (!object(observations)) fail();
    for (const [id, o] of Object.entries(observations)) {
      const kind = statusKind(o);
      if (!object(o) || !keys(o, kind === 'success' ? ['status','categories','verdict'] : ['status']) ||
          (kind !== 'success' && Object.keys(o).length !== 1)) fail();
      if (kind !== 'success') continue;
      const unit = probe === 'policy' ? bundle.policyUnits.find(u => u.id === id) :
        bundle.detectionUnits.find(u => u.id === id);
      if (!unit || !uniqueStrings(o.categories) || o.categories.some(label =>
        !Object.hasOwn(mapping[engine], label) ||
        (probe === 'policy' && unit.nativeAllowedEntityTypes[engine].includes(label))) ||
        (probe === 'policy' && !['accepted','rejected'].includes(o.verdict)) ||
        o.verdict !== (o.categories.length ? 'rejected' : 'accepted')) fail();
    }
  }
  const projected = { schemaVersion: 1, runStatus: bundle.runStatus,
    capabilities: { categories: bundle.capabilities.categories, engines: Object.fromEntries(engines.map(e =>
      [e, { supportedCategories: bundle.capabilities.engines[e].supportedCategories }])) },
    detectionUnits: bundle.detectionUnits, policyUnits: bundle.policyUnits.map(({ nativeAllowedEntityTypes, ...unit }) => unit),
    observations: Object.fromEntries(engines.map(e => [e, Object.fromEntries(probes.map(p =>
      [p, Object.fromEntries(Object.entries(bundle.observations[e][p]).map(([id,o]) => [id,
        o.status === 200 ? { ...o, categories: projectFindings(e, o.categories, mapping) } : o]))]) )])) };
  projectedCatalogs.set(projected, new Set(bundle.capabilities.categories));
  return projected;
}

/** Compare to the gold loaded for this run; standalone rendering checks schema and links only. */
export function validateReleaseBundle(bundle, plan) {
  const summary = analyzeBundle(bundle);
  if (bundle.runStatus === 'complete' && summary.runStatus !== 'complete') fail();
  if (bundle.schemaVersion === 2 && plan !== undefined && engines.some(e =>
    !same(Object.keys(bundle.capabilities.engines[e].mapping), Object.keys(nativeToGold[e])) ||
    Object.entries(nativeToGold[e]).some(([label,gold]) => bundle.capabilities.engines[e].mapping[label] !== gold))) fail();
  const legacy = plan === undefined && same(bundle.capabilities.categories, historicalCategories) &&
    same(bundle.capabilities.engines.presidio.supportedCategories, historicalCategories) &&
    same(bundle.capabilities.engines.horizon.supportedCategories, historicalHorizon);
  const seven = TARGET_CATEGORIES.filter(c => !['IT_IDENTITY_CARD','IT_DRIVER_LICENSE'].includes(c));
  if (bundle.schemaVersion === 1) {
    if (!legacy && !(plan === undefined && same(bundle.capabilities.categories, seven) &&
      engines.every(e => same(bundle.capabilities.engines[e].supportedCategories, seven)))) fail();
  } else if (plan !== undefined && (!same(bundle.capabilities.categories, TARGET_CATEGORIES) ||
      engines.some(e => !same(bundle.capabilities.engines[e].supportedCategories, TARGET_CATEGORIES)))) fail();
  if (plan === undefined) return bundle;
  if (!Array.isArray(plan.detection) || !Array.isArray(plan.policy) ||
      bundle.detectionUnits.length !== plan.detection.length || bundle.policyUnits.length !== plan.policy.length) fail();
  const actualDetection = new Map(bundle.detectionUnits.map(u => [u.id, u]));
  const actualPolicy = new Map(bundle.policyUnits.map(u => [u.id, u]));
  for (const expected of plan.detection) {
    const actual = actualDetection.get(expected.detectionCaseId);
    if (!actual || actual.fieldId !== expected.fieldId ||
      metadataKeys.some(k => actual[k] !== expected[k]) ||
      !same(actual.sourceIds, expected.sourceIds) ||
      !same(actual.expectedEntities, expected.expectedEntities) ||
      !Array.isArray(actual.strata) || actual.strata.length !== expected.strata.length ||
      expected.strata.some(s => !actual.strata.some(t =>
        t.sourceId === s.sourceId && t.focusCategory === s.focusCategory && t.scenario === s.scenario &&
        t.fieldId === s.fieldId && t.provenanceId === s.provenanceId &&
        t.expectedVerdict === s.expectedVerdict && t.focusPolarity === s.focusPolarity &&
        same(t.allowedEntityTypes ?? [], s.allowedEntityTypes ?? []) &&
        JSON.stringify(t.annotation) === JSON.stringify(s.annotation ? Object.fromEntries(
          ['target','form','checksum','assignment','domesticCin'].filter(k =>
            Object.hasOwn(s.annotation,k)).map(k => [k,s.annotation[k]])) : undefined)))) fail();
  }
  const sourceToDetection = new Map(plan.detection.flatMap(d => d.sourceIds.map(id => [id, d.detectionCaseId])));
  for (const expected of plan.policy) {
    const actual = actualPolicy.get(expected.id);
    if (!actual || actual.detectionCaseId !== sourceToDetection.get(expected.id) ||
      actual.fieldId !== expected.fieldId || !same(actual.expectedEntities, expected.expectedEntities) ||
      !same(actual.allowedEntityTypes, expected.allowedEntityTypes) ||
      actual.expectedVerdict !== expected.expectedVerdict ||
      metadataKeys.some(k => actual[k] !== expected[k])) fail();
  }
  return bundle;
}

/**
 * Accepts only the version-1 sanitized bundle; validates the complete frozen plan.
 * observations[engine][probe][unitId] is absent (or status 'unattempted') when not attempted.
 * Successful observations use categories: string[] (native categories after mapping), not findings.
 */
export function analyzeBundle(bundle) {
  if (bundle?.schemaVersion === 2) {
    const projected = projectV2(bundle);
    const summary = analyzeBundle(projected);
    summary.schemaVersion = 2;
    summary.sampleSplit = [...new Set(bundle.detectionUnits.map(u => u.split).filter(Boolean))].join(',') || 'unspecified';
    verifiedSummaries.set(summary, JSON.stringify(summary));
    return summary;
  }
  validateSafeShape(bundle);
  if (!object(bundle) || bundle.schemaVersion !== 1 ||
    !object(bundle.capabilities) || !uniqueStrings(bundle.capabilities.categories) ||
    !object(bundle.capabilities.engines) || !Array.isArray(bundle.detectionUnits) ||
    !Array.isArray(bundle.policyUnits) || !object(bundle.observations)) fail();
  const categories = bundle.capabilities.categories;
  const catalog = new Set(categories);
  const supports = {};
  for (const engine of engines) {
    const entry = bundle.capabilities.engines[engine];
    if (!object(entry) || !uniqueStrings(entry.supportedCategories) ||
      entry.supportedCategories.some(c => !catalog.has(c)) || !object(bundle.observations[engine])) fail();
    supports[engine] = new Set(entry.supportedCategories);
  }
  const detection = new Map();
  const policy = new Map();
  for (const unit of bundle.detectionUnits) {
    if (!object(unit) || !safeId(unit.id) || detection.has(unit.id) ||
      !uniqueStrings(unit.sourceIds) || !unit.sourceIds.length || unit.sourceIds.some(id => !safeId(id)) ||
      !FIELD_IDS.includes(unit.fieldId) ||
      !uniqueStrings(unit.expectedEntities) || unit.expectedEntities.some(c => !catalog.has(c)) ||
      (unit.focusCategory !== undefined && !catalog.has(unit.focusCategory)) ||
      (unit.strata !== undefined && !(Array.isArray(unit.strata) && unit.strata.every(s =>
        object(s) && unit.sourceIds.includes(s.sourceId) && catalog.has(s.focusCategory) &&
        safeId(s.scenario)) &&
        new Set(unit.strata.map(s => s.sourceId)).size === unit.strata.length))) fail();
    detection.set(unit.id, unit);
  }
  for (const unit of bundle.policyUnits) {
    if (!object(unit) || !safeId(unit.id) || policy.has(unit.id) ||
      !detection.has(unit.detectionCaseId) ||
      !detection.get(unit.detectionCaseId).sourceIds.includes(unit.id) ||
      !FIELD_IDS.includes(unit.fieldId) ||
      !uniqueStrings(unit.expectedEntities) || !uniqueStrings(unit.allowedEntityTypes) ||
      [...unit.expectedEntities, ...unit.allowedEntityTypes].some(c => !catalog.has(c)) ||
      !['accepted', 'rejected'].includes(unit.expectedVerdict) ||
      unit.expectedVerdict !== (unit.expectedEntities.some(c => !unit.allowedEntityTypes.includes(c)) ? 'rejected' : 'accepted') ||
      [...unit.expectedEntities].sort().join('\0') !== [...detection.get(unit.detectionCaseId).expectedEntities].sort().join('\0')) fail();
    policy.set(unit.id, unit);
  }
  if (new Set(bundle.detectionUnits.flatMap(u => u.sourceIds)).size !== policy.size ||
    bundle.detectionUnits.some(u => u.sourceIds.some(id => policy.get(id)?.detectionCaseId !== u.id))) fail();
  const sampled = new Set([...detection.values()].flatMap(u => [
    ...u.expectedEntities, u.focusCategory, ...(u.strata?.map(s => s.focusCategory) ?? []),
  ].filter(Boolean)));
  const units = { detection, policy };
  const coverage = Object.fromEntries(engines.map(e => [e, {}]));
  const paired = {};
  for (const probe of probes) {
    const ids = units[probe];
    for (const engine of engines) {
      const obs = bundle.observations[engine][probe];
      if (!object(obs) || Object.keys(obs).some(id => !ids.has(id))) fail();
      const counts = { planned: ids.size, attempted: 0, unattempted: 0, successes: 0,
        technicalErrors: 0, contractErrors: 0, pairedSuccesses: 0, pairedExclusions: 0 };
      for (const [id, unit] of ids) {
        const o = obs[id];
        const kind = statusKind(o);
        if (o !== undefined && (!object(o) ||
          (kind === 'unattempted' && (Object.keys(o).length !== 1 || o.status !== 'unattempted')) ||
          (kind !== 'success' && kind !== 'unattempted' && Object.keys(o).some(k => k !== 'status')) ||
          (kind === 'success' && Object.keys(o).some(k => !['status', 'categories', 'verdict'].includes(k))))) fail();
        if (kind === 'unattempted') { counts.unattempted++; continue; }
        counts.attempted++;
        if (kind === 'technical') { counts.technicalErrors++; continue; }
        if (kind === 'contract') { counts.contractErrors++; continue; }
        if (!uniqueStrings(o.categories) || o.categories.some(c =>
          !(projectedCatalogs.get(bundle) ?? nativeCategories[engine]).has(c)) ||
          (probe === 'policy' && (!['accepted', 'rejected'].includes(o.verdict) ||
            o.categories.some(c => unit.allowedEntityTypes.includes(c)))) ||
          (probe === 'detection' && o.verdict !== undefined && !['accepted', 'rejected'].includes(o.verdict)) ||
          (o.verdict !== undefined && o.verdict !== (o.categories.length ? 'rejected' : 'accepted'))) fail();
        counts.successes++;
      }
      coverage[engine][probe] = counts;
    }
    paired[probe] = [...ids.keys()].filter(id => engines.every(e => statusKind(bundle.observations[e][probe][id]) === 'success'));
    for (const engine of engines) {
      coverage[engine][probe].pairedSuccesses = paired[probe].length;
      coverage[engine][probe].pairedExclusions = ids.size - paired[probe].length;
    }
  }
  const detectionResult = { own: {}, paired: {} };
  for (const cohort of ['own', 'paired']) {
    for (const engine of engines) {
      const byCategory = {};
      const operational = {};
      const focal = {};
      for (const category of [...supports[engine]].filter(c => sampled.has(c)).sort()) {
        const own = [...detection.values()].filter(u => statusKind(bundle.observations[engine].detection[u.id]) === 'success');
        const rows = cohort === 'paired' ? own.filter(u => paired.detection.includes(u.id)) : own;
        const c = empty();
        const focus = empty();
        let correct = 0;
        for (const u of rows) {
          const observed = bundle.observations[engine].detection[u.id].categories.includes(category);
          const expected = u.expectedEntities.includes(category);
          tally(c, expected, observed);
          if (u.focusCategory === category || u.strata?.some(s => s.focusCategory === category))
            tally(focus, expected, observed);
          if (expected === observed) correct++;
        }
        byCategory[category] = score(c);
        focal[category] = score(focus);
        operational[category] = cohort === 'own' && bundle.runStatus === 'complete' &&
          coverage[engine].detection.unattempted === 0 ? ratio(correct, detection.size) : null;
      }
      const values = Object.values(byCategory);
      const strata = {};
      const names = [...new Set([...detection.values()].flatMap(u => u.strata?.map(s => s.scenario).filter(Boolean) ?? []))].sort();
      for (const name of names) {
        const strataCategories = {};
        for (const category of [...supports[engine]].filter(c => sampled.has(c)).sort()) {
          const counts = empty();
          for (const u of detection.values()) {
            if (!u.strata?.some(s => s.scenario === name) ||
              statusKind(bundle.observations[engine].detection[u.id]) !== 'success' ||
              (cohort === 'paired' && !paired.detection.includes(u.id))) continue;
            tally(counts, u.expectedEntities.includes(category),
              bundle.observations[engine].detection[u.id].categories.includes(category));
          }
          strataCategories[category] = score(counts);
        }
        strata[name] = { byCategory: strataCategories };
      }
      const exactRows = [...detection.values()].filter(u =>
        statusKind(bundle.observations[engine].detection[u.id]) === 'success' &&
        (cohort === 'own' || paired.detection.includes(u.id)));
      const exactCorrect = exactRows.filter(u => same(u.expectedEntities,
        bundle.observations[engine].detection[u.id].categories.filter(c => catalog.has(c)))).length;
      detectionResult[cohort][engine] = { byCategory, focusCategory: focal, strata, operational,
        exactSet: { correct: exactCorrect, total: exactRows.length, accuracy: ratio(exactCorrect, exactRows.length) },
        unsupported: categories.filter(c => sampled.has(c) && !supports[engine].has(c)).sort(),
        unsampled: categories.filter(c => !sampled.has(c)).sort(),
        micro: score(values.reduce((a, x) => sum(a, x.counts), empty())),
        macro: Object.fromEntries(['recall', 'precision', 'specificity', 'f1', 'accuracy', 'balancedAccuracy'].map(k => {
          const defined = values.map(v => v[k]).filter(v => v !== null);
          return [k, { value: average(defined), included: defined.length }];
        })) };
    }
  }
  const policyResult = { own: {}, paired: {}, operational: {} };
  for (const cohort of ['own', 'paired']) for (const engine of engines) {
    const c = empty();
    for (const unit of policy.values()) {
      if (statusKind(bundle.observations[engine].policy[unit.id]) !== 'success' ||
        (cohort === 'paired' && !paired.policy.includes(unit.id))) continue;
      tally(c, unit.expectedVerdict === 'rejected', bundle.observations[engine].policy[unit.id].verdict === 'rejected');
    }
    policyResult[cohort][engine] = { ...score(c),
      falseAcceptanceRate: ratio(c.fn, c.tp + c.fn),
      falseRejectionRate: ratio(c.fp, c.tn + c.fp) };
    if (cohort === 'own') policyResult.operational[engine] = bundle.runStatus === 'complete' &&
      coverage[engine].policy.unattempted === 0 ? ratio(c.tp + c.tn, policy.size) : null;
  }
  const incomplete = bundle.runStatus !== 'complete' || engines.some(e => probes.some(p =>
    coverage[e][p].unattempted || coverage[e][p].technicalErrors || coverage[e][p].contractErrors));
  if (!['complete', 'incomplete', 'degraded'].includes(bundle.runStatus)) fail();
  if (incomplete) for (const engine of engines) {
    policyResult.operational[engine] = null;
    for (const category of Object.keys(detectionResult.own[engine].operational))
      detectionResult.own[engine].operational[category] = null;
  }
  const summary = { schemaVersion: 1, runStatus: incomplete ? 'incomplete' : 'complete',
    historicalCatalog: same(categories, historicalCategories),
    coverage, detection: detectionResult, policy: policyResult,
    diagnostics: { extraLabels: Object.fromEntries(engines.map(e => [e, Object.fromEntries(probes.map(p => [p,
      [...units[p]].filter(([id]) => statusKind(bundle.observations[e][p][id]) === 'success')
        .flatMap(([id]) => bundle.observations[e][p][id].categories
          .filter(c => !catalog.has(c)).map(category => ({ id, category }))) ]))])) } };
  if (summary.historicalCatalog) {
    // Frozen pre-seven-category summary layout; the old published artifacts
    // predate exact-set and conditional policy-rate additions.
    delete summary.historicalCatalog;
    for (const cohort of ['own','paired']) for (const engine of engines) {
      delete summary.detection[cohort][engine].exactSet;
      delete summary.policy[cohort][engine].falseAcceptanceRate;
      delete summary.policy[cohort][engine].falseRejectionRate;
    }
    Object.defineProperty(summary, 'legacyHistorical', { value: true });
    const undue = bundle.policyUnits.filter(u => u.expectedVerdict === 'accepted' &&
      bundle.observations.horizon.policy[u.id]?.verdict === 'rejected');
    const extras = undue.filter(u => bundle.observations.horizon.policy[u.id].categories.some(c => !catalog.has(c)));
    const extrasOnly = extras.filter(u => bundle.observations.horizon.policy[u.id].categories.every(c =>
      !catalog.has(c) || u.allowedEntityTypes.includes(c)));
    Object.defineProperty(summary, 'legacyAudit', { value: { undue: undue.length,
      extras: extras.length, extrasOnly: extrasOnly.length,
      categories: Object.keys(summary.detection.paired.presidio.byCategory).length } });
  }
  verifiedSummaries.set(summary, JSON.stringify(summary));
  return summary;
}
