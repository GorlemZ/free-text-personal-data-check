// Test process only. The production CLI never imports this module.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const settings = JSON.parse(readFileSync(process.env.COMPARISON_FAKE_CONFIG, 'utf8'));
const marker = '?test-original';
registerHooks({ load(url, context, nextLoad) {
 if(url.endsWith('/functional/load-corpus.mjs')) return {format:'module',shortCircuit:true,source:`
  export * from ${JSON.stringify(url+marker)};
  import {loadCorpus as original} from ${JSON.stringify(url+marker)};
  export async function loadCorpus(){const p=await original();return {...p,review:{status:'independently-reviewed',reviewer:'FAKE TEST ONLY',reviewedAt:'2026-11-10T00:00:00Z'}};}
 `};
 if(url.endsWith('/functional/config.mjs')) return {format:'module',shortCircuit:true,source:`
  export * from ${JSON.stringify(url+marker)};
  import {loadCapabilities as original} from ${JSON.stringify(url+marker)};
  export async function loadCapabilities(){const c=await original();for(const [n,e] of Object.entries(c.engines))e.expectedImageId=${JSON.stringify(settings.imageIds)}[n];return {...c,alignmentStatus:'independently-reviewed'};}
  export async function countHorizonTokens(){return 8;}
 `};
 if(url.endsWith('/functional/docker-runner.mjs')) return {format:'module',shortCircuit:true,source:`
  import {appendFileSync} from 'node:fs';
  const settings=${JSON.stringify(settings)};
  export function dockerCommand(){return JSON.stringify(settings.registry);}
  export function createFunctionalDockerRunner(){return {async withContainer(image,name,fn){
    appendFileSync(settings.events,name+':start\\n');
    try{return await fn({name:'fake-'+name,url:settings.urls[name],imageId:settings.imageIds[name],signal:new AbortController().signal});}
    finally{appendFileSync(settings.events,name+':stop\\n');}
  } };}
 `};
 return nextLoad(url,context);
} });
