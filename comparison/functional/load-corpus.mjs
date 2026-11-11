import { readFile } from 'node:fs/promises';
import { FIELD_IDS, TARGET_CATEGORIES } from '../catalog.mjs';

const fail = () => { throw new Error('INVALID_CORPUS'); };
const isObject = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const keys = (x, required, optional = []) => isObject(x) &&
  required.every(k => Object.hasOwn(x, k)) &&
  Object.keys(x).every(k => required.includes(k) || optional.includes(k));
const categories = new Set(TARGET_CATEGORIES);
const fields = new Set(FIELD_IDS);
const rowKeys = ['id', 'familyId', 'split', 'scenario', 'focusCategory', 'focusPolarity',
  'fieldId', 'text', 'allowedEntityTypes', 'expectedEntities', 'expectedVerdict',
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
    const rows = JSON.parse(files.corpus);
    const manifest = JSON.parse(files.manifest);
    if (!Array.isArray(rows) || !rows.length ||
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
      if (!keys(p, ['id', 'kind', 'description']) || typeof p.id !== 'string' || !p.id ||
          p.kind !== 'authored-synthetic' || typeof p.description !== 'string' || !p.description || sources.has(p.id)) fail();
      sources.add(p.id);
    }
    const ids = new Set();
    const byText = new Map();
    for (const s of rows) {
      if (!keys(s, rowKeys) || !/^[a-z][a-z0-9-]{0,63}$/.test(s.id) || ids.has(s.id) ||
          typeof s.familyId !== 'string' || !/^[a-z][a-z0-9_-]{0,127}$/.test(s.familyId) ||
          s.split !== 'development' || typeof s.scenario !== 'string' || !s.scenario ||
          !categories.has(s.focusCategory) || !['positive', 'negative'].includes(s.focusPolarity) ||
          !fields.has(s.fieldId) || typeof s.text !== 'string' || !s.text ||
          [...s.text].length > 2000 || Buffer.byteLength(s.text, 'utf8') > 8000 ||
          !validList(s.allowedEntityTypes) || !validList(s.expectedEntities) ||
          !['accepted', 'rejected'].includes(s.expectedVerdict) ||
          s.expectedVerdict !== (s.expectedEntities.some(x => !s.allowedEntityTypes.includes(x)) ? 'rejected' : 'accepted') ||
          (s.focusPolarity === 'positive') !== positive(s) ||
          s.annotationStatus !== manifest.review.status ||
          !sources.has(s.provenanceId) ||
          !keys(s.annotation, annotationKeys, ['rationale', 'domesticCin']) ||
          s.annotation.target !== 'declared-category-presence' ||
          s.annotation.form !== (positive(s) ? 'plausible' : 'absent-or-malformed') ||
          !['not_checked', 'luhn_pass', 'vat_check_digit_pass', 'vat_check_digit_fail',
            'iban_mod97_pass', 'iban_mod97_fail', 'cf_checksum_pass', 'cf_checksum_fail', 'luhn_fail'].includes(s.annotation.checksum) ||
          s.annotation.assignment !== 'not_checked' ||
          (Object.hasOwn(s.annotation, 'domesticCin') && s.annotation.domesticCin !== 'not_checked') ||
          (Object.hasOwn(s.annotation, 'rationale') && typeof s.annotation.rationale !== 'string') ||
          Buffer.byteLength(JSON.stringify(requestFor(s))) > 32768) fail();
      ids.add(s.id);
      const group = byText.get(s.text);
      if (group) {
        const first = group[0];
        if (first.split !== s.split || first.familyId !== s.familyId ||
            [...first.expectedEntities].sort().join() !== [...s.expectedEntities].sort().join()) fail();
        group.push(s);
      } else byText.set(s.text, [s]);
    }
    const counts = { samples: rows.length, detectionSamples: byText.size,
      policyVariants: rows.length - byText.size, categories: new Set(rows.map(s => s.focusCategory)).size,
      fieldIds: new Set(rows.map(s => s.fieldId)).size, families: new Set(rows.map(s => s.familyId)).size };
    if (!keys(manifest.counts, Object.keys(counts)) || Object.entries(counts).some(([k,v]) => manifest.counts[k] !== v) ||
        TARGET_CATEGORIES.some(c => !rows.some(s => s.focusCategory === c && positive(s)) ||
          !rows.some(s => s.focusCategory === c && !positive(s)))) fail();
    // Deduplicate coherent text only; the first source row supplies the detection field.
    const detection = [...byText.values()].map((group, i) => ({
      detectionCaseId: `detection-${String(i + 1).padStart(4, '0')}`,
      sourceIds: group.map(s => s.id), fieldId: group[0].fieldId, text: group[0].text,
      expectedEntities: [...group[0].expectedEntities], split: group[0].split,
      familyId: group[0].familyId,
      strata: group.map(s => ({ sourceId: s.id, fieldId: s.fieldId,
        provenanceId: s.provenanceId, allowedEntityTypes: [...s.allowedEntityTypes],
        expectedVerdict: s.expectedVerdict, focusCategory: s.focusCategory,
        focusPolarity: s.focusPolarity, scenario: s.scenario, annotation: s.annotation })),
    }));
    const policy = rows.map(s => ({ ...s }));
    return { detection, policy, review: manifest.review, manifest };
  } catch { fail(); }
}

export async function loadCorpus(directory = new URL('../', import.meta.url)) {
  const files = Object.fromEntries(await Promise.all(['corpus', 'manifest'].map(async name =>
    [name, await readFile(new URL(`${name}.json`, directory))])));
  return validateCorpusBundle(files);
}

export function requestFor(sample) {
  return { fields: [{ fieldId: sample.fieldId, text: sample.text,
    allowedEntityTypes: Object.hasOwn(sample, 'detectionCaseId') ? [] : sample.allowedEntityTypes }] };
}
