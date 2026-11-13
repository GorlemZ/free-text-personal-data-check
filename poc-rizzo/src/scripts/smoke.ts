import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { composeRuntime } from '../index.js';

export async function smoke(): Promise<void> {
  const { adapter, modelDetectionService: infer } = await composeRuntime();
  await adapter.warmup();
  const samples=[['name','Il referente sintetico si chiama Ada Rossi.'],['email-tail','nota '.repeat(47)+'scrivere a ada.rossi@example.com']] as const;
  for (const [id,text] of samples) {
    const categories=[...await infer(text)].sort();
    console.log(JSON.stringify({id,categories}));
    assert.ok(categories.length>0,`${id}: no entities observed`);
    if(id==='email-tail') assert.ok(categories.includes('EMAIL_ADDRESS'),'tail email was not observed');
  }
  await assert.rejects(()=>infer('abcdef0123456789'.repeat(3000)),/TOKEN_LIMIT/);
  console.log(JSON.stringify({overTokenLimit:'explicit-technical-error',runtime:'node',result:'PASS'}));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await smoke();
