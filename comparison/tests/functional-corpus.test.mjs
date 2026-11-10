import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { loadCorpus, validateCorpusBundle, requestFor } from '../functional/load-corpus.mjs';
const original = Object.fromEntries(await Promise.all(['corpus','manifest'].map(async n => [n, await readFile(new URL(`../${n}.json`, import.meta.url))])));
function edited(key, mutate, rehash = true) {
 const files = {...original}; const data = JSON.parse(files[key]); mutate(data); files[key] = Buffer.from(JSON.stringify(data));
 if (key === 'corpus' && rehash) { const m=JSON.parse(files.manifest); m.corpusSha256=createHash('sha256').update(files.corpus).digest('hex'); files.manifest=Buffer.from(JSON.stringify(m)); }
 return files;
}
const invalid = files => assert.throws(() => validateCorpusBundle(files), /INVALID_CORPUS/);
test('one gold preserves independently counted source strata and separate policy probes', async () => {
 const plan=await loadCorpus(); const m=JSON.parse(original.manifest);
 assert.equal(plan.policy.length,m.counts.samples); assert.equal(plan.detection.length,m.counts.detectionSamples);
 assert.equal(new Set(plan.policy.map(x=>x.id)).size, plan.policy.length);
 assert.deepEqual(plan.detection.flatMap(x=>x.sourceIds).sort(),plan.policy.map(x=>x.id).sort());
 assert.equal(plan.review.status,'pending');
 for (const d of plan.detection) {
  assert.deepEqual(requestFor(d).fields[0].allowedEntityTypes,[]);
  for (const s of d.strata) { const p=plan.policy.find(p=>p.id===s.sourceId); assert.equal(p.fieldId,s.fieldId); assert.deepEqual(s.allowedEntityTypes,p.allowedEntityTypes); }
 }
 for (const p of plan.policy) assert.deepEqual(requestFor(p).fields[0].allowedEntityTypes,p.allowedEntityTypes);
});
test('byte integrity detects edits without a rehashed manifest',()=>invalid(edited('corpus',a=>a[0].text+='x',false)));
for (const [name, mutate] of Object.entries({
 duplicate:a=>a[1].id=a[0].id, verdict:a=>a[0].expectedVerdict='accepted', category:a=>a[0].expectedEntities=['URL'],
 review:a=>a[0].annotationStatus='independently-reviewed', oversize:a=>a[0].text='x'.repeat(2001),
 family:a=>a[1].familyId='other', provenance:a=>a[0].provenanceId='unknown', field:a=>a[0].fieldId='unknown',
 extra:a=>a[0].secret='unapproved', checksum:a=>a[0].annotation.checksum='unknown', polarity:a=>a[0].focusPolarity='negative'
})) test('schema rejects '+name,()=>invalid(edited('corpus',mutate)));
for (const [name,mutate] of Object.entries({count:m=>m.counts.samples++, category:m=>m.counts.categories++,
 review:m=>m.review.status='independently-reviewed', provenance:m=>m.provenance[0].kind='',
 extra:m=>m.unexpected=true, catalog:m=>m.categories.pop(), policy:m=>delete m.policy.PERSON
})) test('manifest rejects '+name,()=>invalid(edited('manifest',mutate)));
