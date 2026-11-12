import assert from 'node:assert/strict';
import { createModel } from '../src/model.mjs';
const infer=await createModel();
const samples=[['name','Il referente sintetico si chiama Ada Rossi.'],['email-tail','nota '.repeat(47)+'scrivere a ada.rossi@example.com']];
for (const [id,text] of samples) {
 const categories=[...await infer(text)].sort();
 console.log(JSON.stringify({id,categories}));
 assert.ok(categories.length>0,`${id}: no entities observed`);
 if(id==='email-tail') assert.ok(categories.includes('EMAIL_ADDRESS'),'tail email was not observed');
}
await assert.rejects(()=>infer('abcdef0123456789'.repeat(3000)),/TOKEN_LIMIT/);
console.log(JSON.stringify({overTokenLimit:'explicit-technical-error',runtime:'node',result:'PASS'}));
