import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeBIO, semanticCategories, createInference } from '../src/model.mjs';
const labels={0:'O',1:'B-FULLNAME',2:'I-FULLNAME',3:'B-ID_DOC',4:'B-CF',5:'B-TELEPHONENUM'};
const tokenizer={all_special_ids:[0],decode(ids){return ids.map(x=>({1:'Ada',2:'Rossi',3:'U12345',4:'RSSMRA80A01H501X',5:'+1 2025550101',6:'+39 3331234567'}[Number(x)])).join(' ');}};
function logits(indices){return {dims:[1,indices.length,6],data:Float32Array.from(indices.flatMap(i=>Array.from({length:6},(_,j)=>j===i?10:-10)))};}
test('model phone fragments cannot bypass full-text rule geography',async()=>{
 const ids=BigInt64Array.from([7n,8n]);
 const t=Object.assign(()=>({input_ids:{data:ids},attention_mask:{data:BigInt64Array.from([1n,1n])}}),{all_special_ids:[],decode:()=> '3331234567'});
 const infer=createInference({tokenizer:t,session:{run:async()=>({logits:logits([0,5])})},id2label:labels,maxTokens:8192});
 assert.deepEqual([...await infer('telefono +1 3331234567')],[]);
});
test('full tokenization rejects oversized input before inference, never silently truncates',async()=>{
 let ran=false; let options;
 const fakeTokenizer=(text,opts)=>{options=opts;return {input_ids:{data:BigInt64Array.from([1n,2n,3n,4n]),dims:[1,4]},attention_mask:{data:BigInt64Array.from([1n,1n,1n,1n]),dims:[1,4]}}};
 const infer=createInference({tokenizer:fakeTokenizer,session:{run:async()=>{ran=true;}},id2label:labels,maxTokens:3});
 await assert.rejects(()=>infer('x'),/TOKEN_LIMIT/);
 assert.equal(options.truncation,false); assert.equal(ran,false);
});
test('inference passes every input token as int64 and returns the tail prediction',async()=>{
 const ids=BigInt64Array.from([0n,1n,2n,0n]);let actual;
 const t=Object.assign(()=>({input_ids:{data:ids},attention_mask:{data:BigInt64Array.from([1n,1n,1n,1n])}}),tokenizer);
 const session={async run(feeds){actual=Array.from(feeds.input_ids.data);return {logits:logits([0,1,2,0])}}};
 const infer=createInference({tokenizer:t,session,id2label:labels,maxTokens:8192});
 assert.deepEqual([...await infer('synthetic')],['PERSON']);assert.deepEqual(actual,[0n,1n,2n,0n]);
});
test('non-finite output is a technical failure, not empty detection',()=>{
 const invalid=logits([1]);invalid.data[0]=NaN;
 assert.throws(()=>decodeBIO([1],invalid,labels,tokenizer),/INVALID_MODEL_OUTPUT/);
});
test('mapping preserves invalid checksum CF, excludes generic ID_DOC and foreign phone',()=>{
 const results=semanticCategories([{label:'CF',text:'RSSMRA80A01H501X',score:0.9},{label:'ID_DOC',text:'U12345',score:0.99},{label:'TELEPHONENUM',text:'+1 2025550101',score:0.99},{label:'FULLNAME',text:'Ada Rossi',score:0.9}]);
 assert.deepEqual([...results].sort(),['IT_FISCAL_CODE','PERSON']);
 // Phone decisions belong exclusively to full-text structured rules.
 assert.deepEqual([...semanticCategories([{label:'TELEPHONENUM',text:'+39 3331234567',score:0.9}])],[]);
});
test('BIO joins a name and ignores special tokens without losing tail entity',()=>{
 const entities=decodeBIO([0,1,2,0],logits([0,1,2,0]),labels,tokenizer);
 assert.deepEqual(entities.map(e=>[e.label,e.text]),[['FULLNAME','Ada Rossi']]);
});
