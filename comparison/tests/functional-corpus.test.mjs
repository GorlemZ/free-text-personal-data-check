import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCorpus, validateCorpusBundle, requestFor } from '../functional/load-corpus.mjs';
const original = Object.fromEntries(await Promise.all(['corpus','manifest'].map(async n => [n, await readFile(new URL(`../${n}.json`, import.meta.url))])));
function edited(key, mutate) {
 const files = {...original}; const data = JSON.parse(files[key]); mutate(data); files[key] = Buffer.from(JSON.stringify(data));
 return files;
}
const invalid = files => assert.throws(() => validateCorpusBundle(files), /INVALID_CORPUS/);
test('one gold preserves independently counted source strata and separate policy probes', async () => {
 const plan=await loadCorpus(); const m=JSON.parse(original.manifest);
 assert.equal(plan.policy.length,m.counts.samples); assert.equal(plan.detection.length,m.counts.detectionSamples);
 assert.equal(new Set(plan.policy.map(x=>x.id)).size, plan.policy.length);
 assert.deepEqual(plan.detection.flatMap(x=>x.sourceIds).sort(),plan.policy.map(x=>x.id).sort());
 assert.deepEqual(plan.review,m.review);
 for (const d of plan.detection) {
  assert.deepEqual(requestFor(d).fields[0].allowedEntityTypes,[]);
  for (const s of d.strata) { const p=plan.policy.find(p=>p.id===s.sourceId); assert.equal(p.fieldId,s.fieldId); assert.deepEqual(s.allowedEntityTypes,p.allowedEntityTypes); }
 }
 for (const p of plan.policy) assert.deepEqual(requestFor(p).fields[0].allowedEntityTypes,p.allowedEntityTypes);
});
test('a consistently reviewed bundle is accepted and mismatched review statuses are rejected',()=>{
 const rows=JSON.parse(original.corpus);
 const manifest=JSON.parse(original.manifest);
 manifest.review={status:'independently-reviewed',reviewer:'independent-test-reviewer',reviewedAt:'2026-11-11T00:00:00Z'};
 for(const row of rows) row.annotationStatus=manifest.review.status;
 const reviewed={corpus:Buffer.from(JSON.stringify(rows)),manifest:Buffer.from(JSON.stringify(manifest))};
 assert.deepEqual(validateCorpusBundle(reviewed).review,manifest.review);
 const brokenRows=structuredClone(rows); brokenRows[0].annotationStatus='pending';
 invalid({...reviewed,corpus:Buffer.from(JSON.stringify(brokenRows))});
 const brokenManifest=structuredClone(manifest);
 brokenManifest.review={status:'pending',reviewer:null,reviewedAt:null};
 invalid({...reviewed,manifest:Buffer.from(JSON.stringify(brokenManifest))});
});

test('hash-free bundle accepts annotation edits while preserving the row schema',()=>{
 const files=edited('corpus',a=>a[0].annotation.rationale='Synthetic editorial clarification.');
 const plan=validateCorpusBundle(files);
 assert.deepEqual(Object.keys(plan).sort(),['detection','manifest','policy','review']);
 assert.equal(plan.policy[0].annotation.rationale,'Synthetic editorial clarification.');
 assert.equal(plan.detection[0].strata[0].annotation.rationale,'Synthetic editorial clarification.');
});
test('deduplication uses text alone, retaining first-source field and every annotation',()=>{
 const files=edited('corpus',rows=>{
  const first=rows.findIndex(r=>r.id==='person-0'); const second=rows.findIndex(r=>r.id==='person-0-allow');
  [rows[first],rows[second]]=[rows[second],rows[first]];
  rows[first].annotation.domesticCin='not_checked';
 });
 const plan=validateCorpusBundle(files);
 const source=plan.policy.find(r=>r.id==='person-0-allow');
 const detection=plan.detection.find(r=>r.sourceIds.includes(source.id));
 assert.equal(detection.sourceIds[0],source.id);
 assert.equal(detection.fieldId,source.fieldId);
 assert.ok(detection.strata.some(s=>s.fieldId!==source.fieldId));
 assert.deepEqual(detection.strata[0].annotation,source.annotation);
 assert.deepEqual(requestFor(detection).fields[0].allowedEntityTypes,[]);
 assert.equal(plan.detection.length,JSON.parse(original.manifest).counts.detectionSamples);
});
test('duplicate texts may reorder category sets but cannot disagree on gold',()=>{
 const coherent=edited('corpus',rows=>rows.find(r=>r.id==='mixed-structured-all').expectedEntities.reverse());
 assert.doesNotThrow(()=>validateCorpusBundle(coherent));
 invalid(edited('corpus',rows=>{
  const r=rows.find(r=>r.id==='person-0-allow');
  r.expectedEntities.push('EMAIL_ADDRESS'); r.expectedVerdict='rejected';
 }));
});
test('allowlist changes must retain the verdict derived from complete gold',()=>{
 invalid(edited('corpus',rows=>rows.find(r=>r.id==='person-0-allow').allowedEntityTypes=['EMAIL_ADDRESS']));
 const files=edited('corpus',rows=>{
  const r=rows.find(r=>r.id==='person-0-allow');
  r.allowedEntityTypes=['EMAIL_ADDRESS']; r.expectedVerdict='rejected';
 });
 assert.doesNotThrow(()=>validateCorpusBundle(files));
});
for (const [name, mutate] of Object.entries({
 duplicate:a=>a[1].id=a[0].id, verdict:a=>a[0].expectedVerdict='accepted', category:a=>a[0].expectedEntities=['URL'],
 review:a=>a[0].annotationStatus=a[0].annotationStatus==='pending'?'independently-reviewed':'pending', oversize:a=>a[0].text='x'.repeat(2001),
 family:a=>a[1].familyId='other', provenance:a=>a[0].provenanceId='unknown', field:a=>a[0].fieldId='unknown',
 extra:a=>a[0].secret='unapproved', checksum:a=>a[0].annotation.checksum='unknown', polarity:a=>a[0].focusPolarity='negative',
 split:a=>a[1].split='heldout', allowlist:a=>a[1].allowedEntityTypes=['URL'],
 duplicateCategory:a=>a[0].expectedEntities.push(a[0].expectedEntities[0]),
 annotationExtra:a=>a[0].annotation.unapproved=true, annotationRationale:a=>a[0].annotation.rationale={unexpected:true}
})) test('schema rejects '+name,()=>invalid(edited('corpus',mutate)));
for (const [name,mutate] of Object.entries({count:m=>m.counts.samples++, category:m=>m.counts.categories++,
 review:m=>m.review.status=m.review.status==='pending'?'independently-reviewed':'pending', provenance:m=>m.provenance[0].kind='',
 extra:m=>m.unexpected=true, catalog:m=>m.categories.pop(), policy:m=>delete m.policy.PERSON,
 limitationObject:m=>m.limitations=[{unapproved:'nested metadata'}], limitationEmpty:m=>m.limitations=[''],
 detectionCount:m=>m.counts.detectionSamples++, policyCount:m=>m.counts.policyVariants++,
 fieldCount:m=>m.counts.fieldIds++, familyCount:m=>m.counts.families++
})) test('manifest rejects '+name,()=>invalid(edited('manifest',mutate)));
