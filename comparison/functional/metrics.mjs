// Pure, sanitized functional-suite aggregation; no corpus or detector imports.
import { TARGET_CATEGORIES, FIELD_IDS } from '../catalog.mjs';
import { LABEL_MAP } from '../../poc-horizon/src/categories.mjs';

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
const nativeCategories = {
  presidio: new Set([...historicalCategories, 'NRP']),
  horizon: new Set([...Object.values(LABEL_MAP), 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE']),
};
const keys = (value, required, optional = []) => object(value) &&
  required.every(k => Object.hasOwn(value, k)) &&
  Object.keys(value).every(k => required.includes(k) || optional.includes(k));
const optional = (value, valid) => value === undefined || valid(value);
const safeFamily = value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,127}$/.test(value);
const metadataKeys = ['split', 'familyId', 'scenario', 'focusCategory', 'focusPolarity',
  'provenanceId', 'annotationStatus', 'tokenCount', 'limitChallenge'];
const metadataValid = (unit, catalog) =>
  optional(unit.split, x => x === 'development') && optional(unit.familyId, safeFamily) &&
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
        ({ ...LABEL_MAP, IT_FISCAL_CODE: 'IT_FISCAL_CODE', IT_VAT_CODE: 'IT_VAT_CODE', IBAN_CODE: 'IBAN_CODE' })[native] !== label))) fail();
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

/** Compare to the gold loaded for this run; standalone rendering checks schema and links only. */
export function validateReleaseBundle(bundle, plan) {
  const summary = analyzeBundle(bundle);
  if (bundle.runStatus === 'complete' && summary.runStatus !== 'complete') fail();
  const legacy = plan === undefined && same(bundle.capabilities.categories, historicalCategories) &&
    same(bundle.capabilities.engines.presidio.supportedCategories, historicalCategories) &&
    same(bundle.capabilities.engines.horizon.supportedCategories, historicalHorizon);
  if (!legacy && (!same(bundle.capabilities.categories, TARGET_CATEGORIES) ||
      engines.some(e => !same(bundle.capabilities.engines[e].supportedCategories, TARGET_CATEGORIES)))) fail();
  if (plan === undefined) return bundle;
  if (!Array.isArray(plan.detection) || !Array.isArray(plan.policy) ||
      bundle.detectionUnits.length !== plan.detection.length || bundle.policyUnits.length !== plan.policy.length) fail();
  const actualDetection = new Map(bundle.detectionUnits.map(u => [u.id, u]));
  const actualPolicy = new Map(bundle.policyUnits.map(u => [u.id, u]));
  for (const expected of plan.detection) {
    const actual = actualDetection.get(expected.detectionCaseId);
    if (!actual || actual.fieldId !== expected.fieldId ||
      actual.focusCategory !== expected.focusCategory ||
      !same(actual.sourceIds, expected.sourceIds) ||
      !same(actual.expectedEntities, expected.expectedEntities) ||
      !Array.isArray(actual.strata) || actual.strata.length !== expected.strata.length ||
      expected.strata.some(s => !actual.strata.some(t =>
        t.sourceId === s.sourceId && t.focusCategory === s.focusCategory && t.scenario === s.scenario))) fail();
  }
  const sourceToDetection = new Map(plan.detection.flatMap(d => d.sourceIds.map(id => [id, d.detectionCaseId])));
  for (const expected of plan.policy) {
    const actual = actualPolicy.get(expected.id);
    if (!actual || actual.detectionCaseId !== sourceToDetection.get(expected.id) ||
      actual.fieldId !== expected.fieldId || !same(actual.expectedEntities, expected.expectedEntities) ||
      !same(actual.allowedEntityTypes, expected.allowedEntityTypes) ||
      actual.expectedVerdict !== expected.expectedVerdict) fail();
  }
  return bundle;
}

/**
 * Accepts only the version-1 sanitized bundle; validates the complete frozen plan.
 * observations[engine][probe][unitId] is absent (or status 'unattempted') when not attempted.
 * Successful observations use categories: string[] (native categories after mapping), not findings.
 */
export function analyzeBundle(bundle) {
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
        if (!uniqueStrings(o.categories) || o.categories.some(c => !nativeCategories[engine].has(c)) ||
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
  verifiedSummaries.set(summary, JSON.stringify(summary));
  return summary;
}
