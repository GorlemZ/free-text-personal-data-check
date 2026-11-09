import { FIELD_IDS, TARGET_CATEGORIES } from './catalog.mjs';

const target = new Set(TARGET_CATEGORIES);
const fields = new Set(FIELD_IDS);
const keys = ['allowedEntityTypes', 'expectedEntities', 'expectedVerdict', 'fieldId', 'id', 'text'];
const count = () => ({ tp: 0, fp: 0, fn: 0, tn: 0, attempted: 0, completed: 0 });
const fail = () => { throw new Error('INVALID_CORPUS'); };

export function validateCorpus(samples) {
  if (!Array.isArray(samples) || !samples.length) fail();
  const ids = new Set();
  for (const s of samples) {
    if (!s || Array.isArray(s) || typeof s !== 'object' ||
      Object.keys(s).sort().join() !== keys.join() ||
      typeof s.id !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/.test(s.id) || ids.has(s.id) ||
      !fields.has(s.fieldId) || typeof s.text !== 'string' ||
      [...s.text].length > 2000 || Buffer.byteLength(s.text, 'utf8') > 8000 ||
      !['accepted', 'rejected'].includes(s.expectedVerdict)) fail();
    ids.add(s.id);
    for (const list of [s.allowedEntityTypes, s.expectedEntities]) {
      if (!Array.isArray(list) || list.some(x => !target.has(x)) ||
        new Set(list).size !== list.length) fail();
    }
  }
  return true;
}

function increment(counter, expected, observed) {
  counter[expected ? (observed ? 'tp' : 'fn') : (observed ? 'fp' : 'tn')]++;
}

export function analyzeResults(samples, results, supported) {
  validateCorpus(samples);
  if (!(supported instanceof Set) || ![...supported].every(x => target.has(x)) ||
    !Array.isArray(results) || results.length !== samples.length) throw new Error('INVALID_RESULTS');
  const resultById = new Map(results.map(x => [x.id, x]));
  if (resultById.size !== samples.length ||
    samples.some(s => !resultById.has(s.id))) throw new Error('INVALID_RESULTS');
  const byCategory = Object.fromEntries([...supported].sort().map(x => [x, count()]));
  const verdict = count();
  const diagnostics = [];
  let completed = 0;
  for (const sample of samples) {
    const { detector, policy } = resultById.get(sample.id);
    for (const category of supported) byCategory[category].attempted++;
    verdict.attempted++;
    if (detector.status !== 200 || policy.status !== 200) continue;
    if (!Array.isArray(detector.body.findings) || !Array.isArray(policy.body.findings) ||
      !['accepted', 'rejected'].includes(policy.body.verdict) ||
      detector.body.findings.some(x => x.fieldId !== sample.fieldId) ||
      policy.body.findings.some(x => x.fieldId !== sample.fieldId ||
        sample.allowedEntityTypes.includes(x.entityType))) throw new Error('INVALID_RESULTS');
    completed++;
    verdict.completed++;
    const observed = new Set(detector.body.findings.map(x => x.entityType));
    const expected = new Set(sample.expectedEntities);
    const missed = [];
    const unexpected = [];
    for (const category of supported) {
      byCategory[category].completed++;
      increment(byCategory[category], expected.has(category), observed.has(category));
      if (expected.has(category) && !observed.has(category)) missed.push(category);
      if (!expected.has(category) && observed.has(category)) unexpected.push(category);
    }
    increment(verdict, sample.expectedVerdict === 'rejected', policy.body.verdict === 'rejected');
    const extraLabels = [...observed].filter(x => !target.has(x)).sort();
    diagnostics.push({ id: sample.id, missed: missed.sort(), unexpected: unexpected.sort(),
      extraLabels, expectedVerdict: sample.expectedVerdict, observedVerdict: policy.body.verdict });
  }
  return { samples: { attempted: samples.length, completed,
    technicalErrors: samples.length - completed }, byCategory,
  unsupported: TARGET_CATEGORIES.filter(x => !supported.has(x)).sort(), verdict, diagnostics };
}
