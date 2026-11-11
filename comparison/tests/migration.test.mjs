import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFile, mkdtemp, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';
const python=fileURLToPath(new URL('../../poc-spacy/.venv/bin/python',import.meta.url));
async function isolatedGenerator(t) {
 const directory=await mkdtemp(join(tmpdir(),'comparison-gold-'));
 t.after(()=>rm(directory,{recursive:true,force:true}));
 const script=join(directory,'generate-gold.py');
 await copyFile(new URL('../generate-gold.py',import.meta.url),script);
 return {directory,script};
}
test('one seven-category corpus has consistent recorded review metadata', async () => {
 assert.deepEqual(TARGET_CATEGORIES, ['PERSON','EMAIL_ADDRESS','PHONE_NUMBER','IT_FISCAL_CODE','IT_VAT_CODE','IBAN_CODE','CREDIT_CARD']);
 const plan = await loadCorpus();
 assert.ok(['pending','independently-reviewed'].includes(plan.review.status));
 assert.ok(plan.policy.every(row=>row.annotationStatus===plan.review.status));
 assert.ok(plan.policy.length > plan.detection.length);
 assert.deepEqual(Object.keys(plan).sort(), ['detection','manifest','policy','review']);
 const sealedKeys = [];
 const visit = value => {
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
   if (/hash|sha256/i.test(key)) sealedKeys.push(key);
   visit(child);
  }
 };
 visit(plan);
 assert.deepEqual(sealedKeys, [], 'corpus, manifest and loader output have no integrity-seal fields');
});
test('generator is byte-deterministic and resets only recorded review metadata',async(t)=>{
 const {directory,script}=await isolatedGenerator(t);
 const first={};
 for(let attempt=0;attempt<2;attempt++) {
  const result=spawnSync(python,[script],{encoding:'utf8'});
  assert.equal(result.status,0,'offline generator exits successfully');
  const manifest=JSON.parse(await readFile(join(directory,'manifest.json')));
  assert.deepEqual(JSON.parse(result.stdout),manifest.counts);
  assert.deepEqual(manifest.review,{status:'pending',reviewer:null,reviewedAt:null});
  for(const name of ['corpus','manifest']) {
   const actual=await readFile(join(directory,`${name}.json`));
   if(attempt===0) first[name]=actual;
   else assert.ok(actual.equals(first[name]),`${name}: deterministic fresh generations`);
   const expected=JSON.parse(await readFile(new URL(`../${name}.json`,import.meta.url)));
   if(name==='corpus') for(const row of expected) row.annotationStatus='pending';
   else expected.review={status:'pending',reviewer:null,reviewedAt:null};
   assert.deepEqual(JSON.parse(actual),expected,`${name}: unchanged gold except review metadata`);
  }
 }
});
test('generator refuses phone metadata drift before writing gold',async(t)=>{
 const {directory,script}=await isolatedGenerator(t);
 const result=spawnSync(python,['-c',
  "import phonenumbers,runpy,sys; phonenumbers.__version__='0.0.0'; runpy.run_path(sys.argv[1],run_name='__main__')",script],{encoding:'utf8'});
 assert.notEqual(result.status,0,'unreviewed metadata must not silently relabel or regenerate gold');
 assert.match(result.stderr,/GOLD_PHONE_METADATA_VERSION_MISMATCH/);
 await assert.rejects(access(join(directory,'corpus.json')),{code:'ENOENT'});
 await assert.rejects(access(join(directory,'manifest.json')),{code:'ENOENT'});
});
