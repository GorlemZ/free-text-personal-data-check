import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer, request} from 'node:http';
import {once} from 'node:events';

export async function verifyBurst(createAdmission) {
  const admission=createAdmission(2), gate=Promise.withResolvers(), calls=[];
  const jobs=Array.from({length:8},(_,i)=>admission.run(async()=>{calls.push(i);await gate.promise;if(i===0)throw Error('synthetic');return i;}));
  const observed=jobs.map(job=>job.then(value=>({value}),error=>({error:error.message})));
  await new Promise(resolve=>setImmediate(resolve));
  try { assert.deepEqual(calls,[0,1],'SAME_TURN_CAPACITY'); }
  finally {gate.resolve();}
  const results=await Promise.all(observed);
  assert.deepEqual(results.slice(2),Array.from({length:6},()=>({error:'SATURATED'})),'NO_EXCESS_EXECUTION');
  assert.equal(await admission.run(async()=>42),42,'ERROR_RECOVERY');
}

export function admissionTests(engine) {
 test('same-turn burst reserves pending slots, rejects every excess and recovers after errors',async()=>{
  const {createAdmission}=await import(`../../poc-${engine}/dist/utilities/admission.js`);
  for(const value of [0,-1,1.2,NaN,Infinity,Number.MAX_SAFE_INTEGER+1])assert.throws(()=>createAdmission(value),/CONCURRENCY/);
  await verifyBurst(createAdmission);
 });
 test('client disconnect and timeout do not release a whole multi-field request', {timeout:10000},async t=>{
  const {createApp}=await import(`../../poc-${engine}/dist/app.js`);
  const {analysisServiceBuilder}=await import(`../../poc-${engine}/dist/services/analysisService.js`);
  const first=Promise.withResolvers(), second=Promise.withResolvers(), enteredFirst=Promise.withResolvers(), enteredSecond=Promise.withResolvers();
  const trace=[];
  t.after(()=>{first.resolve();second.resolve();});
  const infer=async text=>{trace.push(text);if(text==='first'){enteredFirst.resolve();await first.promise;}if(text==='second'){enteredSecond.resolve();await second.promise;}return engine==='horizon'?[]:new Set();};
  const analysisService=engine==='horizon'?analysisServiceBuilder({adapter:{ready:()=>true,prepare:text=>({text}),infer:({text})=>infer(text)},recognize:()=>new Set()}):analysisServiceBuilder({modelDetectionService:infer,ruleDetectionService:()=>new Set()});
  const server=createServer(createApp({analysisService,ready:()=>true,concurrency:1}));
  server.listen(0,'127.0.0.1');await once(server,'listening');
  t.after(()=>{server.closeAllConnections();server.close();});
  const base=`http://127.0.0.1:${server.address().port}`;
  const body=JSON.stringify({fields:[{fieldId:'a',text:'first'},{fieldId:'b',text:'second'}]});
  const client=request(base+'/v1/analyze',{method:'POST',headers:{'content-type':'application/json'}},res=>res.resume());
  client.on('error',()=>{});client.end(body);await enteredFirst.promise;
  // A transport timeout terminates the client, not the underlying inference.
  const closed=new Promise(resolve=>client.once('close',resolve));
  client.setTimeout(1,()=>client.destroy());await closed;
  const post=body=>fetch(base+'/v1/analyze',{method:'POST',headers:{'content-type':'application/json'},body});
  assert.equal((await post('{"fields":[]}')).status,400,'validation precedes admission');
  assert.equal((await fetch(base+'/health/ready')).status,200);
  assert.equal((await post(body)).status,503);assert.deepEqual(trace,['first']);
  first.resolve();await enteredSecond.promise;
  assert.equal((await post(body)).status,503);assert.deepEqual(trace,['first','second'],'slot spans fields');
  second.resolve();await new Promise(resolve=>setImmediate(resolve));
  const response=await post(JSON.stringify({fields:[{fieldId:'c',text:'recovery'}]}));
  assert.equal(response.status,200);assert.deepEqual(trace,['first','second','recovery']);
 });
}
