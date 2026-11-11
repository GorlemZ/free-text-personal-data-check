import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCorpus, validateCorpusBundle, requestFor } from '../functional/load-corpus.mjs';

const original = Object.fromEntries(await Promise.all(['corpus', 'gold', 'manifest'].map(async n =>
  [n, await readFile(new URL(`../${n}.json`, import.meta.url))])));
const data = key => JSON.parse(original[key]);
function edited(key, mutate) {
  const files = { ...original };
  const value = data(key);
  mutate(value);
  files[key] = Buffer.from(JSON.stringify(value));
  return files;
}
const invalid = files => assert.throws(() => validateCorpusBundle(files), /INVALID_CORPUS/);
const peers = rows => {
  const first = rows.find(r => rows.some(other => other !== r && other.textIndex === r.textIndex));
  assert.ok(first, 'at least one policy variant');
  return [first, rows.find(r => r !== first && r.textIndex === first.textIndex)];
};

test('literal input index identifies each distinct text and metadata remains separate', async () => {
  const texts = data('corpus');
  const rows = data('gold');
  const plan = await loadCorpus();
  assert.ok(texts.every(x => typeof x === 'string' && x === x.trim() && x.length));
  assert.equal(new Set(texts).size, texts.length);
  assert.ok(rows.every(r => Number.isInteger(r.textIndex) && !Object.hasOwn(r, 'text')));
  assert.equal(plan.detection.length, texts.length);
  assert.deepEqual(plan.detection.map(d => d.text), texts);
  assert.deepEqual(plan.policy.map(p => p.text), rows.map(r => texts[r.textIndex]));
  for (const d of plan.detection) assert.equal(requestFor(d).fields[0].text, texts[d.textIndex]);
  for (const p of plan.policy) assert.equal(requestFor(p).fields[0].text, texts[p.textIndex]);
});

test('evaluation gold retains distinct-text mix and independent positive-family accounting', () => {
  const texts = data('corpus');
  const rows = data('gold');
  const distinct = texts.map((text, i) => ({ ...rows.find(r => r.textIndex === i), text }));
  const priorities = ['PERSON', 'IT_FISCAL_CODE', 'EMAIL_ADDRESS', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'];
  assert.ok(texts.length >= 250 && texts.length <= 300);
  assert.ok(rows.every(row => row.split === 'evaluation'));
  const lengths = texts.map(text => [...text].length).sort((a, b) => a - b);
  assert.ok(lengths[Math.floor(lengths.length / 2)] >= 100, 'existing draft median length, not realism approval');
  const priority = distinct.filter(row => priorities.includes(row.focusCategory)).length;
  assert.ok(priority / texts.length >= 0.75 && priority / texts.length <= 0.85);
  for (const category of priorities) {
    const families = new Set(distinct.filter(row => row.expectedEntities.includes(category)).map(row => row.familyId));
    assert.ok(families.size >= 25, `${category}: ${families.size} recorded families, not independently reviewed`);
  }
  for (const category of ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'])
    assert.ok(distinct.some(row => row.focusCategory === category && row.focusPolarity === 'negative' && row.scenario !== 'excluded-category-distractor'), `${category}: targeted negative`);
});

test('every annotation links once to an indexed detection text, retaining policy scenarios', async () => {
  const plan = await loadCorpus();
  const manifest = data('manifest');
  assert.equal(plan.policy.length, manifest.counts.samples);
  assert.equal(plan.detection.length, manifest.counts.detectionSamples);
  assert.deepEqual(plan.detection.flatMap(d => d.sourceIds).sort(), plan.policy.map(p => p.id).sort());
  assert.deepEqual(plan.detection.map(d => d.textIndex), data('corpus').map((_, i) => i));
  assert.deepEqual(plan.review, manifest.review);
  for (const d of plan.detection) {
    assert.deepEqual(requestFor(d).fields[0].allowedEntityTypes, []);
    for (const s of d.strata) {
      const p = plan.policy.find(p => p.id === s.sourceId);
      assert.equal(p.fieldId, s.fieldId);
      assert.deepEqual(s.allowedEntityTypes, p.allowedEntityTypes);
    }
  }
  for (const p of plan.policy) assert.deepEqual(requestFor(p).fields[0].allowedEntityTypes, p.allowedEntityTypes);
});

test('metadata identifiers rejected by the release bundle are rejected before collection', () => {
  invalid(edited('gold', rows => { rows[0].scenario = 'contains spaces'; }));
  invalid(edited('gold', rows => { rows[0].scenario = 'x'.repeat(300); }));
  const rows = data('gold');
  const manifest = data('manifest');
  const originalId = rows[0].provenanceId;
  for (const row of rows) if (row.provenanceId === originalId) row.provenanceId = 'unsafe value';
  manifest.provenance.find(p => p.id === originalId).id = 'unsafe value';
  invalid({ ...original, gold: Buffer.from(JSON.stringify(rows)),
    manifest: Buffer.from(JSON.stringify(manifest)) });
});

test('a consistently reviewed bundle is accepted, but inconsistent review metadata is rejected', () => {
  const rows = data('gold');
  const manifest = data('manifest');
  manifest.review = { status: 'independently-reviewed', reviewer: 'independent-test-reviewer', reviewedAt: '2026-11-11T00:00:00Z' };
  for (const row of rows) row.annotationStatus = manifest.review.status;
  const reviewed = { ...original, gold: Buffer.from(JSON.stringify(rows)), manifest: Buffer.from(JSON.stringify(manifest)) };
  assert.deepEqual(validateCorpusBundle(reviewed).review, manifest.review);
  const brokenRows = structuredClone(rows);
  brokenRows[0].annotationStatus = 'pending';
  invalid({ ...reviewed, gold: Buffer.from(JSON.stringify(brokenRows)) });
  manifest.review = { status: 'pending', reviewer: null, reviewedAt: null };
  invalid({ ...reviewed, manifest: Buffer.from(JSON.stringify(manifest)) });
});

test('annotation editorial edits retain the closed gold schema and both linked projections', () => {
  const files = edited('gold', rows => rows[0].annotation.rationale = 'Synthetic editorial clarification.');
  const plan = validateCorpusBundle(files);
  assert.deepEqual(Object.keys(plan).sort(), ['detection', 'manifest', 'policy', 'review']);
  assert.equal(plan.policy[0].annotation.rationale, 'Synthetic editorial clarification.');
  assert.equal(plan.detection[0].strata[0].annotation.rationale, 'Synthetic editorial clarification.');
});

test('indexed policy variants retain first-source detection field and every annotation', () => {
  let promotedId;
  const files = edited('gold', rows => {
    const [first, second] = peers(rows);
    const a = rows.indexOf(first); const b = rows.indexOf(second);
    [rows[a], rows[b]] = [rows[b], rows[a]];
    promotedId = rows[a].id;
    rows[a].annotation.domesticCin = 'not_checked';
  });
  const plan = validateCorpusBundle(files);
  const source = plan.policy.find(r => r.id === promotedId);
  const detection = plan.detection[source.textIndex];
  assert.equal(detection.sourceIds[0], source.id);
  assert.equal(detection.fieldId, source.fieldId);
  assert.deepEqual(detection.strata[0].annotation, source.annotation);
  assert.deepEqual(requestFor(detection).fields[0].allowedEntityTypes, []);
});

test('same-index category order can differ but gold sets and families must agree', () => {
  const coherent = edited('gold', rows => {
    const [first, peer] = peers(rows.filter(r => r.expectedEntities.length > 0));
    assert.ok(first); peer.expectedEntities.reverse();
  });
  assert.doesNotThrow(() => validateCorpusBundle(coherent));
  invalid(edited('gold', rows => { const [first, peer] = peers(rows); peer.familyId = 'unrelated-family'; }));
  invalid(edited('gold', rows => {
    const [first, peer] = peers(rows.filter(r => r.expectedEntities.length > 0));
    peer.expectedEntities = []; peer.expectedVerdict = 'accepted';
    peer.focusPolarity = 'negative'; peer.annotation.form = 'absent-or-malformed';
  }));
});

test('allowlist changes require a verdict derived from the full indexed gold', () => {
  const source = data('gold').find(r => r.expectedEntities.length && r.expectedEntities.some(c => !r.allowedEntityTypes.includes(c)));
  invalid(edited('gold', rows => rows.find(r => r.id === source.id).allowedEntityTypes = [...source.expectedEntities]));
  assert.doesNotThrow(() => validateCorpusBundle(edited('gold', rows => {
    const row = rows.find(r => r.id === source.id);
    row.allowedEntityTypes = [...source.expectedEntities]; row.expectedVerdict = 'accepted';
  })));
});

for (const [name, mutate] of Object.entries({
  duplicateText: a => a[1] = a[0], emptyText: a => a[0] = '', paddedText: a => a[0] = ` ${a[0]}`,
  nonStringText: a => a[0] = { value: a[0] }, oversizeText: a => a[0] = 'x'.repeat(2001),
})) test('corpus rejects ' + name, () => invalid(edited('corpus', mutate)));
for (const [name, mutate] of Object.entries({
  duplicateId: a => a[1].id = a[0].id,
  missingIndex: a => { const lone = a.find(r => a.filter(other => other.textIndex === r.textIndex).length === 1); assert.ok(lone); lone.textIndex = a.find(r => r.textIndex !== lone.textIndex).textIndex; },
  negativeIndex: a => a[0].textIndex = -1,
  outOfRangeIndex: a => a[0].textIndex = data('corpus').length,
  fractionalIndex: a => a[0].textIndex = 0.5,
  absentIndex: a => delete a[0].textIndex,
  textInMetadata: a => a[0].text = data('corpus')[0],
  duplicateScenario: a => { const [first, peer] = peers(a); Object.assign(peer, { ...structuredClone(first), id: peer.id }); },
  verdict: a => a[0].expectedVerdict = a[0].expectedVerdict === 'accepted' ? 'rejected' : 'accepted',
  category: a => a[0].expectedEntities = ['URL'],
  review: a => a[0].annotationStatus = a[0].annotationStatus === 'pending' ? 'independently-reviewed' : 'pending',
  family: a => { const [first, peer] = peers(a); peer.familyId = 'unrelated-family'; },
  provenance: a => a[0].provenanceId = 'unknown', field: a => a[0].fieldId = 'unknown',
  extra: a => a[0].secret = 'unapproved', checksum: a => a[0].annotation.checksum = 'unknown',
  polarity: a => a[0].focusPolarity = a[0].focusPolarity === 'positive' ? 'negative' : 'positive',
  split: a => a[1].split = 'heldout', allowlist: a => a[1].allowedEntityTypes = ['URL'],
  duplicateCategory: a => { const positive = a.find(r => r.expectedEntities.length); positive.expectedEntities.push(positive.expectedEntities[0]); },
  annotationExtra: a => a[0].annotation.unapproved = true,
  annotationRationale: a => a[0].annotation.rationale = { unexpected: true },
})) test('gold rejects ' + name, () => invalid(edited('gold', mutate)));
for (const [name, mutate] of Object.entries({
  count: m => m.counts.samples++, category: m => m.counts.categories++,
  review: m => m.review.status = m.review.status === 'pending' ? 'independently-reviewed' : 'pending', provenance: m => m.provenance[0].kind = '',
  extra: m => m.unexpected = true, catalog: m => m.categories.pop(),
  policy: m => delete m.policy.PERSON,
  limitationObject: m => m.limitations = [{ unapproved: 'nested metadata' }],
  limitationEmpty: m => m.limitations = [''], detectionCount: m => m.counts.detectionSamples++,
  policyCount: m => m.counts.policyVariants++, fieldCount: m => m.counts.fieldIds++, familyCount: m => m.counts.families++,
})) test('manifest rejects ' + name, () => invalid(edited('manifest', mutate)));
