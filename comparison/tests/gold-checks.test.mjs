// Independent of generate-gold.py and both PoCs: checksum/format audit, not human review.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const rows = JSON.parse(await readFile(new URL('../corpus.json', import.meta.url)));
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
const cf = value => {
 const s=value.toUpperCase(); if(!/^[A-Z]{6}\d{2}[ABCDEHLMPRST]\d{2}[A-Z]\d{3}[A-Z]$/.test(s))return false;
 const table=[1,0,5,7,9,13,15,17,19,21,2,4,18,20,11,3,6,8,12,14,16,10,22,25,24,23];
 let sum=0; for(let i=0;i<15;i++) {const c=s[i];const n=/\d/.test(c)?Number(c):c.charCodeAt(0)-65;sum+=i%2?n:table[n];}
 return String.fromCharCode(65+sum%26)===s[15];
};
test('generated structured positives pass independent checks and checksum negatives fail',()=>{
 const validators={luhn_pass:luhn,vat_check_digit_pass:vat,iban_mod97_pass:iban,cf_checksum_pass:cf};
 for(const r of rows) {
  const value=r.text.slice(r.text.indexOf(': ')+2,-1);
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
 assert.ok(rows.every(r=>r.annotationStatus==='pending'));
});
test('all numeric phone positives and boundary negatives are checked independently with metadata', async()=>{
 const {execFileSync}=await import('node:child_process');
 const python=new URL('../../poc-spacy/.venv/bin/python',import.meta.url);
 const script=`import json,sys,phonenumbers,re
rows=json.load(open(sys.argv[1]))
checked=0
for r in rows:
 if not r['id'].startswith('phone-'): continue
 value=r['text'][10:-1]
 # Whole candidate, never parse a valid substring from malformed/Unicode-adjacent input.
 valid=bool(re.fullmatch(r'(?:\\+|00)?[0-9][0-9 ()-]*[0-9]',value))
 if valid:
  try: valid=phonenumbers.is_valid_number(phonenumbers.parse(value,'IT'))
  except phonenumbers.NumberParseException: valid=False
 assert valid==('PHONE_NUMBER' in r['expectedEntities']),r['id']
 checked+=1
print('METADATA_CHECKED',checked)
`;
 const {fileURLToPath}=await import('node:url');
 const out=execFileSync(fileURLToPath(python),['-c',script,fileURLToPath(new URL('../corpus.json',import.meta.url))],{encoding:'utf8'});
 assert.match(out,/METADATA_CHECKED/);
});
