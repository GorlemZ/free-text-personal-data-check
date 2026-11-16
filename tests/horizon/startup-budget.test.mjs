import test from 'node:test';
import {budgetHttpTests} from '../contract/budget-runtime.mjs';
budgetHttpTests('horizon');
import assert from 'node:assert/strict';
import {transformersAdapterBuilder} from '../../poc-horizon/dist/adapters/transformersAdapter.js';
import {analysisServiceBuilder} from '../../poc-horizon/dist/services/analysisService.js';
test('explicit startup returns ready adapter; each field budgets immediately before inference', async () => {
 const trace=[];
 const pipeline=Object.assign(async text=>{trace.push('infer:'+text);return [];},{tokenizer:text=>{trace.push('budget:'+text);return {input_ids:{size:text==='overflow'?4:3}};}});
 const adapter=await transformersAdapterBuilder({tokenBudget:3,loadRuntime:async()=>{trace.push('load');return {env:{},pipeline:async()=>pipeline};}});
 assert.deepEqual(trace,['load']);
 const service=analysisServiceBuilder({adapter,recognize:()=>new Set()});
 await assert.rejects(service.analyze([{fieldId:'a',text:'ok',allowedCategories:[]},{fieldId:'b',text:'overflow',allowedCategories:[]},{fieldId:'c',text:'never',allowedCategories:[]}]),/TOKEN_BUDGET/);
 assert.deepEqual(trace,['load','budget:ok','infer:ok','budget:overflow']);
});

test('startup validates external integers and model/tokenizer limits before use', async () => {
 const {loadConfig}=await import('../../poc-horizon/dist/config/config.js');
 for(const value of ['', '0', '-1', '1.5', 'NaN', 'Infinity', '9007199254740992']) {
  assert.throws(()=>loadConfig({ANALYZER_CONCURRENCY:value}),/CONCURRENCY/);
  assert.throws(()=>loadConfig({ANALYZER_TOKEN_BUDGET:value}),/TOKEN_BUDGET/);
 }
 assert.equal(loadConfig({}).concurrency,1);
 assert.equal(loadConfig({}).tokenBudget,512);
 assert.equal(loadConfig({ANALYZER_CONCURRENCY:'2',ANALYZER_TOKEN_BUDGET:'8'}).tokenBudget,8);
 const pipeline=Object.assign(async()=>[],{model:{config:{max_position_embeddings:512}},tokenizer:Object.assign(()=>({input_ids:{size:1}}),{model_max_length:8})});
 await assert.rejects(transformersAdapterBuilder({tokenBudget:9,loadRuntime:async()=>({env:{},pipeline:async()=>pipeline})}),/TOKEN_BUDGET/);
});
