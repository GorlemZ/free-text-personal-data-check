import { readFile } from 'node:fs/promises';
import { FIELD_IDS, TARGET_CATEGORIES } from '../catalog.mjs';

const fail = () => { throw new Error('INVALID_CORPUS'); };
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, required, optional = []) => isObject(x) &&
  required.every(k => Object.hasOwn(x, k)) &&
  Object.keys(x).every(k => required.includes(k) || optional.includes(k));
const categories = new Set(TARGET_CATEGORIES);
const fields = new Set(FIELD_IDS);
const safeId = x => typeof x === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(x);
const rowKeys = ['id', 'textIndex', 'familyId', 'split', 'scenario', 'focusCategory',
  'focusPolarity', 'fieldId', 'allowedEntityTypes', 'expectedEntities', 'expectedVerdict',
  'provenanceId', 'annotationStatus', 'annotation'];
const annotationKeys = ['target', 'form', 'checksum', 'assignment'];
const validList = xs => Array.isArray(xs) && xs.every(x => categories.has(x)) && new Set(xs).size === xs.length;
const positive = s => s.expectedEntities.includes(s.focusCategory);
const reviewValid = r => keys(r, ['status', 'reviewer', 'reviewedAt']) &&
  (r.status === 'pending' ? r.reviewer === null && r.reviewedAt === null :
    r.status === 'independently-reviewed' && typeof r.reviewer === 'string' && r.reviewer.trim() &&
    typeof r.reviewedAt === 'string' && Number.isFinite(Date.parse(r.reviewedAt)));

export function validateCorpusBundle(files) {
  try {
    const texts = JSON.parse(files.corpus);
    const rows = JSON.parse(files.gold);
    const manifest = JSON.parse(files.manifest);
    if (!Array.isArray(texts) || !texts.length ||
        texts.some(text => typeof text !== 'string' || !text || text !== text.trim() ||
          [...text].length > 2000 || Buffer.byteLength(text, 'utf8') > 8000) ||
        new Set(texts).size !== texts.length ||
        !Array.isArray(rows) || !rows.length ||
        !keys(manifest, ['schemaVersion', 'review', 'heldout', 'sourceData',
          'categories', 'counts', 'provenance', 'limitations', 'policy']) ||
        manifest.schemaVersion !== 1 || !reviewValid(manifest.review) || manifest.heldout !== false ||
        manifest.sourceData !== 'synthetic' ||
        !validList(manifest.categories) || manifest.categories.length !== TARGET_CATEGORIES.length ||
        !isObject(manifest.counts) || !Array.isArray(manifest.provenance) ||
        !Array.isArray(manifest.limitations) || !manifest.limitations.length ||
        manifest.limitations.some(x => typeof x !== 'string' || !x.trim()) ||
        !keys(manifest.policy, TARGET_CATEGORIES) ||
        Object.values(manifest.policy).some(x => typeof x !== 'string' || !x)) fail();
    const sources = new Set();
    for (const p of manifest.provenance) {
      if (!keys(p, ['id', 'kind', 'description']) || !safeId(p.id) ||
          !['authored-synthetic', 'faker-synthetic', 'local-seeded', 'mixed-synthetic'].includes(p.kind) ||
          typeof p.description !== 'string' || !p.description || sources.has(p.id)) fail();
      sources.add(p.id);
    }
    const ids = new Set();
    const scenarios = new Set();
    const byIndex = new Map();
    const policy = [];
    for (const s of rows) {
      if (!keys(s, rowKeys) || !safeId(s.id) || ids.has(s.id) ||
          !Number.isInteger(s.textIndex) || s.textIndex < 0 || s.textIndex >= texts.length ||
          typeof s.familyId !== 'string' || !/^[a-z][a-z0-9_-]{0,127}$/.test(s.familyId) ||
          s.split !== 'evaluation' || !safeId(s.scenario) ||
          !categories.has(s.focusCategory) || !['positive', 'negative'].includes(s.focusPolarity) ||
          !fields.has(s.fieldId) || !validList(s.allowedEntityTypes) || !validList(s.expectedEntities) ||
          !['accepted', 'rejected'].includes(s.expectedVerdict) ||
          s.expectedVerdict !== (s.expectedEntities.some(x => !s.allowedEntityTypes.includes(x)) ? 'rejected' : 'accepted') ||
          (s.focusPolarity === 'positive') !== positive(s) ||
          s.annotationStatus !== manifest.review.status || !sources.has(s.provenanceId) ||
          !keys(s.annotation, annotationKeys, ['rationale', 'domesticCin']) ||
          s.annotation.target !== 'declared-category-presence' ||
          s.annotation.form !== (positive(s) ? 'plausible' : 'absent-or-malformed') ||
          !['not_checked', 'luhn_pass', 'vat_check_digit_pass', 'vat_check_digit_fail',
            'iban_mod97_pass', 'iban_mod97_fail', 'cf_checksum_pass', 'cf_checksum_fail', 'luhn_fail'].includes(s.annotation.checksum) ||
          s.annotation.assignment !== 'not_checked' ||
          (Object.hasOwn(s.annotation, 'domesticCin') && s.annotation.domesticCin !== 'not_checked') ||
          (Object.hasOwn(s.annotation, 'rationale') && typeof s.annotation.rationale !== 'string')) fail();
      const scenarioKey = JSON.stringify([s.textIndex, s.scenario, s.focusCategory,
        s.fieldId, [...s.allowedEntityTypes].sort()]);
      if (scenarios.has(scenarioKey)) fail();
      scenarios.add(scenarioKey);
      ids.add(s.id);
      const projected = { ...s, text: texts[s.textIndex] };
      if (Buffer.byteLength(JSON.stringify(requestFor(projected))) > 32768) fail();
      policy.push(projected);
      const group = byIndex.get(s.textIndex);
      if (group) {
        const first = group[0];
        if (first.split !== s.split || first.familyId !== s.familyId ||
            [...first.expectedEntities].sort().join() !== [...s.expectedEntities].sort().join()) fail();
        group.push(projected);
      } else byIndex.set(s.textIndex, [projected]);
    }
    // Every literal is a detector input; no unannotated text may silently disappear.
    if (byIndex.size !== texts.length) fail();
    const counts = { samples: rows.length, detectionSamples: texts.length,
      policyVariants: rows.length - texts.length, categories: new Set(rows.map(s => s.focusCategory)).size,
      fieldIds: new Set(rows.map(s => s.fieldId)).size, families: new Set(rows.map(s => s.familyId)).size };
    if (!keys(manifest.counts, Object.keys(counts)) || Object.entries(counts).some(([k, v]) => manifest.counts[k] !== v) ||
        TARGET_CATEGORIES.some(c => !rows.some(s => s.focusCategory === c && positive(s)) ||
          !rows.some(s => s.focusCategory === c && !positive(s)))) fail();
    // First indexed annotation supplies the detection field; text is always the exact literal.
    const detection = texts.map((text, i) => {
      const group = byIndex.get(i);
      return {
        detectionCaseId: `detection-${String(i + 1).padStart(4, '0')}`,
        textIndex: i, sourceIds: group.map(s => s.id), fieldId: group[0].fieldId, text,
        expectedEntities: [...group[0].expectedEntities], split: group[0].split,
        familyId: group[0].familyId,
        strata: group.map(s => ({ sourceId: s.id, fieldId: s.fieldId,
          provenanceId: s.provenanceId, allowedEntityTypes: [...s.allowedEntityTypes],
          expectedVerdict: s.expectedVerdict, focusCategory: s.focusCategory,
          focusPolarity: s.focusPolarity, scenario: s.scenario, annotation: s.annotation })),
      };
    });
    return { detection, policy, review: manifest.review, manifest };
  } catch { fail(); }
}

export async function loadCorpus(directory = new URL('../', import.meta.url)) {
  const files = Object.fromEntries(await Promise.all(['corpus', 'gold', 'manifest'].map(async name =>
    [name, await readFile(new URL(`${name}.json`, directory))])));
  return validateCorpusBundle(files);
}

export function requestFor(sample) {
  return { fields: [{ fieldId: sample.fieldId, text: sample.text,
    allowedEntityTypes: Object.hasOwn(sample, 'detectionCaseId') ? [] : sample.allowedEntityTypes }] };
}
