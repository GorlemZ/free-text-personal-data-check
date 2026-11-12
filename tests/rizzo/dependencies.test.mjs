import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
test('one ONNX Runtime native ABI across direct and tokenizer dependencies',async()=>{
 const lock=JSON.parse(await readFile(new URL('../../poc-rizzo/package-lock.json',import.meta.url),'utf8'));
 const versions=new Set(Object.entries(lock.packages).filter(([key])=>key.endsWith('node_modules/onnxruntime-node')).map(([,value])=>value.version));
 assert.equal(versions.size,1,'multiple ONNX shared-library versions conflict on Linux');
});
