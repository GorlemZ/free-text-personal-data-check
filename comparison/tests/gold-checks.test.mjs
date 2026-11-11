// Independent of generate-gold.py and both PoCs: checksum/format audit, not human review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const rows = JSON.parse(await readFile(new URL('../corpus.json', import.meta.url)));
const originalManifest = await readFile(new URL('../manifest.json', import.meta.url));
const categories = ['PERSON','EMAIL_ADDRESS','PHONE_NUMBER','IT_FISCAL_CODE','IT_VAT_CODE','IBAN_CODE','CREDIT_CARD'];

test('every category has isolated and contextual positives plus targeted negatives',()=>{
 for(const category of categories) {
  assert.ok(rows.some(r=>r.focusCategory===category && r.focusPolarity==='positive' && r.scenario==='isolated'),`${category}: isolated positive`);
  assert.ok(rows.some(r=>r.focusCategory===category && r.focusPolarity==='positive' && r.scenario==='positive'),`${category}: contextual positive`);
  assert.ok(rows.some(r=>r.focusCategory===category && r.focusPolarity==='negative' && r.scenario!=='excluded-category-distractor'),`${category}: targeted negative`);
 }
 for(const id of ['person-single-given-context','person-single-surname-context']) {
  const row=rows.find(r=>r.id===id);
  assert.ok(row,id);
  assert.deepEqual(row.expectedEntities,['PERSON'],id);
  assert.equal(row.scenario,'single-name-context',id);
 }
 assert.ok(rows.some(r=>r.scenario==='ambiguous-single-name' && r.focusCategory==='PERSON' && r.focusPolarity==='negative'));
});
test('wrong-category allowlists never exempt a positive in any target category',()=>{
 for(const category of categories) {
  const wrong=rows.find(r=>r.focusCategory===category && r.focusPolarity==='positive' && r.scenario==='wrong-allowlist');
  assert.ok(wrong,`${category}: wrong allowlist`);
  assert.ok(wrong.allowedEntityTypes.length,wrong.id);
  assert.ok(wrong.allowedEntityTypes.every(c=>!wrong.expectedEntities.includes(c)),wrong.id);
  assert.equal(wrong.expectedVerdict,'rejected',wrong.id);
  const peers=rows.filter(r=>r.text===wrong.text);
  assert.ok(peers.some(r=>r.allowedEntityTypes.length===0 && r.expectedVerdict==='rejected'),wrong.id);
  assert.ok(peers.some(r=>r.expectedVerdict==='accepted' && r.expectedEntities.every(c=>r.allowedEntityTypes.includes(c))),wrong.id);
 }
});
test('formatted values, mutations and reused mixture controls remain correlated families',()=>{
 const sameFamily=ids=>{
  const samples=ids.map(id=>{ const row=rows.find(r=>r.id===id); assert.ok(row,id); return row; });
  assert.equal(new Set(samples.map(r=>r.familyId)).size,1,ids.join(','));
 };
 for(const ids of [
  ['phone-0','phone-1','phone-0-isolated','phone-negative-4'],
  ['phone-2','phone-3'],['phone-8','phone-10','phone-negative-7','phone-negative-8'],['phone-9','phone-11'],
  ['cf-0','cf-1','cf-negative-0','cf-0-isolated'],
  ['vat-0','vat-1','vat-negative-0'],['iban-0','iban-1','iban-negative-0'],
  ['person-0','person-0-isolated','person-single-given-context','person-single-surname-context','mixed-person-email'],
  ['email-0','url-email-overlap','mixed-person-email'],
  ['cf-0','vat-0','iban-0','card-16-compact','phone-0','mixed-structured','mixed-valid-invalid'],
 ]) sameFamily(ids);
 for(let length=13;length<=19;length++) sameFamily(['compact','spaces','hyphens'].map(form=>`card-${length}-${form}`).concat(`card-fail-${length}`));
 const manifest=JSON.parse(originalManifest);
 assert.ok(manifest.limitations.some(s=>/famil/i.test(s) && /correlat/i.test(s)));
});
const luhn = value => {
 const digits=[...value.replace(/[ -]/g,'')].map(Number); let total=0;
 for(let i=0;i<digits.length;i++) { let d=digits[i]; if(i%2===digits.length%2) { d*=2; if(d>9)d-=9; } total+=d; }
 return digits.length>=13&&digits.length<=19&&total%10===0;
};
const vat = value => {
 const d=[...value.replace(/^IT/,'')].map(Number); if(d.length!==11||d.every(n=>n===0))return false;
 let sum=0; for(let i=0;i<11;i++)sum+=i%2 ? [0,2,4,6,8,1,3,5,7,9][d[i]] : d[i]; return sum%10===0;
};
const iban = value => {
 const s=value.replaceAll(' ',''); if(!/^IT\d{2}[A-Z]\d{10}[A-Z0-9]{12}$/.test(s))return false;
 let rem=0; for(const c of s.slice(4)+s.slice(0,4))for(const digit of /[A-Z]/.test(c)?String(c.charCodeAt(0)-55):c)rem=(rem*10+Number(digit))%97;
 return rem===1;
};
const cfChecksum = value => {
 const s=value.toUpperCase(); if(!/^[A-Z0-9]{16}$/.test(s))return false;
 const table=[1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23];
 let sum=0; for(let i=0;i<15;i++) {const c=s[i];const n=/\d/.test(c)?Number(c):c.charCodeAt(0)-65;sum+=i%2?n:table[n];}
 return String.fromCharCode(65+sum%26)===s[15];
};
const cf = value => /^[A-Z]{6}\d{2}[ABCDEHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/.test(value.toUpperCase()) && cfChecksum(value);
test('omocodia is excluded by scope, not mislabeled as an invalid checksum',()=>{
 const row=rows.find(r=>r.id==='cf-negative-3');
 assert.equal(row.scenario,'out-of-scope-omocodia');
 const value=row.text.slice('Codice fiscale: '.length,-1);
 assert.equal(cfChecksum(value),true,row.id);
 assert.equal(cf(value),false,row.id);
 assert.deepEqual(row.expectedEntities,[]);
 assert.match(row.annotation.rationale,/out of scope/i);
});
test('full structured gold includes independent checksum-valid overlaps in every text',()=>{
 const boundary='[\\p{L}\\p{M}\\p{N}_]';
 const whole=body=>new RegExp(`(?<!${boundary})${body}(?!${boundary})`,'gu');
 const structured={
  IT_FISCAL_CODE:[whole('[A-Za-z]{6}[0-9]{2}[ABCDEHLMPRSTabcdehlmprst][0-9]{2}[A-Za-z][0-9]{3}[A-Za-z]'),cf],
  IT_VAT_CODE:[whole('(?:IT)?[0-9]{11}'),vat],
  IBAN_CODE:[whole('I *T *(?:[0-9] *){2}[A-Z] *(?:[0-9] *){10}(?:[A-Z0-9] *){11}[A-Z0-9]'),iban],
  CREDIT_CARD:[whole('[0-9]+(?:[ -][0-9]+)*'),luhn],
 };
 const errors=[];
 for(const row of rows) for(const [category,[pattern,valid]] of Object.entries(structured)) {
  const present=[...row.text.matchAll(pattern)].some(match=>valid(match[0]));
  if(present!==row.expectedEntities.includes(category)) errors.push(`${row.id}:${category}:${present?'missing':'unexpected'}`);
 }
 assert.deepEqual(errors,[], 'all structured categories are annotated, including non-focus overlaps');
});
test('email gold follows syntax without a delivery or dotted-domain requirement',()=>{
 // Independent ASCII dot-atom audit of these fixtures; RFC 5322 section 3.4.1.
 const valid=value=>/^[A-Za-z0-9_+%-]+(?:\.[A-Za-z0-9_+%-]+)*@[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(value);
 const errors=[];
 for(const row of rows) {
  const candidates=row.text.match(/[A-Za-z0-9._+%-]*@+[A-Za-z0-9.-]*/g)||[];
  const present=candidates.some(value=>valid(value.replace(/\.$/,'')));
  if(present!==row.expectedEntities.includes('EMAIL_ADDRESS')) errors.push(row.id);
 }
 assert.deepEqual(errors,[], 'complete syntactic email gold');
});
test('one numeric candidate keeps both phone and VAT gold through every allowlist',()=>{
 const base=rows.find(r=>r.id==='phone-vat-overlap');
 assert.ok(base,'phone/VAT overlap control');
 assert.deepEqual([...base.expectedEntities].sort(),['IT_VAT_CODE','PHONE_NUMBER']);
 assert.ok(vat(base.text.slice('Recapito: '.length,-1)),base.id);
 const peers=rows.filter(r=>r.text===base.text);
 for(const allowed of [[],['PHONE_NUMBER'],['IT_VAT_CODE'],['PHONE_NUMBER','IT_VAT_CODE'],['EMAIL_ADDRESS']]) {
  const row=peers.find(r=>[...r.allowedEntityTypes].sort().join() === [...allowed].sort().join());
  assert.ok(row,`overlap allowlist ${allowed.join(',')||'empty'}`);
  assert.deepEqual([...row.expectedEntities].sort(),['IT_VAT_CODE','PHONE_NUMBER'],row.id);
  assert.equal(row.expectedVerdict,allowed.includes('PHONE_NUMBER') && allowed.includes('IT_VAT_CODE') ? 'accepted' : 'rejected',row.id);
  assert.equal(row.familyId,base.familyId,row.id);
 }
});
test('generated structured positives pass independent checks and checksum negatives fail',()=>{
 const validators={luhn_pass:luhn,vat_check_digit_pass:vat,iban_mod97_pass:iban,cf_checksum_pass:cf};
 for(const r of rows) {
  const value=r.scenario==='isolated' ? r.text : r.text.slice(r.text.indexOf(': ')+2,-1);
  if(validators[r.annotation.checksum]) assert.ok(validators[r.annotation.checksum](value),r.id);
  if(r.annotation.checksum==='luhn_fail') assert.equal(luhn(value),false,r.id);
 }
 for(const prefix of ['cf','vat','iban']) {
  const bad=rows.find(r=>r.id===prefix+'-negative-0');
  assert.equal(({cf,vat,iban})[prefix](bad.text.split(': ')[1].slice(0,-1)),false,bad.id);
 }
 assert.equal(vat('00000000000'),false);
});
test('card lengths, forms, former excluded axes, mixtures and allowlists are represented',()=>{
 for(let n=13;n<=19;n++)for(const f of ['compact','spaces','hyphens']) assert.ok(rows.some(r=>r.id===`card-${n}-${f}`));
 assert.equal(rows.filter(r=>r.scenario==='excluded-category-distractor').length,11);
 assert.ok(rows.some(r=>r.expectedEntities.length>=5));
 assert.ok(rows.some(r=>r.allowedEntityTypes.length&&r.expectedVerdict==='rejected'));
 assert.ok(rows.some(r=>r.expectedEntities.length>1&&r.expectedVerdict==='accepted'));
 assert.ok(rows.every(r=>r.annotationStatus===JSON.parse(originalManifest).review.status));
});
test('manifest distinguishes gold phone metadata from the two runtime dependencies',async()=>{
 const manifest=JSON.parse(originalManifest);
 const horizon=JSON.parse(await readFile(new URL('../../poc-horizon/package.json',import.meta.url)));
 const spacy=await readFile(new URL('../../poc-spacy/pyproject.toml',import.meta.url),'utf8');
 const pythonVersion=spacy.match(/phonenumbers==([0-9.]+)/)[1];
 const disclosure=manifest.limitations.join(' ');
 assert.ok(disclosure.includes('phonenumbers '+pythonVersion));
 assert.ok(disclosure.includes('libphonenumber-js '+horizon.dependencies['libphonenumber-js']));
 assert.match(disclosure,/equivalence.*not|not.*equivalence/i);
});
test('all phone gold including non-focus overlaps is checked independently with metadata', async()=>{
 const {execFileSync}=await import('node:child_process');
 const python=new URL('../../poc-spacy/.venv/bin/python',import.meta.url);
 const script=`import json,sys,phonenumbers,re,unicodedata
rows=json.load(open(sys.argv[1],encoding='utf-8'))
def word(c): return c.isalnum() or c=='_' or unicodedata.category(c).startswith('M')
for r in rows:
 valid=False
 if r['focusCategory']=='PHONE_NUMBER' or 'PHONE_NUMBER' in r['expectedEntities']:
  assert '*' not in r['text'],r['id']
 # Consume the entire numeric envelope, not an inner metadata-valid substring.
 for match in re.finditer(r'(?:\\+|00)?[0-9][0-9 ()-]*[0-9]',r['text']):
  if match.start() and word(r['text'][match.start()-1]): continue
  if match.end()<len(r['text']) and word(r['text'][match.end()]): continue
  try: valid=valid or phonenumbers.is_valid_number(phonenumbers.parse(match[0],'IT'))
  except phonenumbers.NumberParseException: pass
 assert valid==('PHONE_NUMBER' in r['expectedEntities']),r['id']
print(json.dumps(dict(checked=len(rows),version=phonenumbers.__version__)))
`;
 const {fileURLToPath}=await import('node:url');
 const out=execFileSync(fileURLToPath(python),['-c',script,fileURLToPath(new URL('../corpus.json',import.meta.url))],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const audit=JSON.parse(out);
 assert.equal(audit.checked,rows.length);
 assert.ok(JSON.parse(originalManifest).provenance.some(p=>p.description.includes('phonenumbers '+audit.version)));
});
