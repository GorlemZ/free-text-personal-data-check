import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { boundaryCases } from './async-boundary.mjs';
const adapterURL = new URL('../../../poc-rizzo/dist/adapters/transformersAdapter.js', import.meta.url).href;
const sdk = 'data:text/javascript,' + encodeURIComponent(`
 export const env={}; export const AutoModelForTokenClassification={from_pretrained:async()=>{throw Error('NO_REAL_LOADER');}};
 export class PreTrainedTokenizer {constructor(){return (...args)=>globalThis.portFixture.tokenizer(...args);}}
 export class TokenClassificationPipeline {constructor(){return (...args)=>globalThis.portFixture.pipeline(...args);}}
`);
registerHooks({ resolve(s, c, next) { return s === '@huggingface/transformers' && c.parentURL === adapterURL ? { url: sdk, shortCircuit: true } : next(s, c); } });
const { transformersAdapterBuilder } = await import(adapterURL);
const directory = await mkdtemp(join(tmpdir(), 'rizzo-C1-then-'));
try {
 const files = { 'config.json': '{"max_position_embeddings":1}', 'tokenizer.json': '{}', 'model.onnx': 'synthetic-only' };
 for (const [name, content] of Object.entries(files)) await writeFile(join(directory, name), content);
 await writeFile(join(directory, 'manifest.json'), JSON.stringify({ files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) }));
 let loads = 0;
 const rows = await boundaryCases(async options => {
   globalThis.portFixture = options;
   const adapter = transformersAdapterBuilder();
   const promise = adapter.warmup({ directory: pathToFileURL(directory + '/'), manifestPath: pathToFileURL(join(directory, 'manifest.json')), loadModel: async (path, options) => {
     loads++; assert.equal(path, directory + '/'); assert.deepEqual(options, { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true }); return {};
   } });
   assert.equal(adapter.warmup({}), promise); await promise;
   return adapter.infer;
 });
 assert.equal(loads, rows.length);
 // Integrity remains in the real initialization path, not bypassed by the SDK sentinel.
 await writeFile(join(directory, 'model.onnx'), 'different');
 let forbiddenLoads = 0;
 await assert.rejects(transformersAdapterBuilder().warmup({ directory: pathToFileURL(directory + '/'), manifestPath: pathToFileURL(join(directory, 'manifest.json')), loadModel: async () => { forbiddenLoads++; return {}; } }), /MODEL_INTEGRITY_FAILURE/);
 assert.equal(forbiddenLoads, 0);
 console.log(JSON.stringify({ rows, loads, hashNegativeControl: true }));
} finally { delete globalThis.portFixture; await rm(directory, { recursive: true, force: true }); }
