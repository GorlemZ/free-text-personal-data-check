import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { loadCapabilities } from '../functional/config.mjs';
const exec=promisify(execFile);
const cli=fileURLToPath(new URL('../functional/run.mjs',import.meta.url));
const hook=fileURLToPath(new URL('./fixtures/cli-bootstrap.mjs',import.meta.url));
test('real CLI validates pending review without Docker and refuses collection',async()=>{
 const result=await exec(process.execPath,[cli,'--validate-only']);
 assert.match(result.stdout,/review=pending alignment=pending/);
 const failed=await exec(process.execPath,[cli,'--presidio-image','fake:p','--horizon-image','fake:h','--output-dir','unused']).catch(e=>e);
 assert.equal(failed.code,1);assert.match(failed.stderr,/GOLD_REVIEW_PENDING/);
});
for(const mode of ['complete','503','malformed'])test('real CLI with fake HTTP services: '+mode,async()=>{
 const directory=await mkdtemp(join(tmpdir(),'comparison-cli-')); const servers=[]; const urls={};const calls={presidio:0,horizon:0};
 const plan=await loadCorpus(); const caps=await loadCapabilities();
 const cf=plan.policy.find(p=>p.id==='cf-0').text.split(': ')[1].slice(0,-1);
 const labels={'contatto@example.com':'EMAIL_ADDRESS',[cf]:'IT_FISCAL_CODE','12345678903':'IT_VAT_CODE','IT60X0542811101000000123456':'IBAN_CODE'};
 try {
  for(const name of ['presidio','horizon']) {
   const server=createServer(async(req,res)=>{
    res.setHeader('content-type','application/json');
    if(req.url==='/health/ready'){res.end('{"status":"ready"}');return;}
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    const field=JSON.parse(Buffer.concat(chunks)).fields[0];calls[name]++;
    if(name==='presidio'&&calls[name]===3&&mode==='503'){res.statusCode=503;res.end('{"code":"ANALYZER_UNAVAILABLE"}');return;}
    if(name==='presidio'&&calls[name]===3&&mode==='malformed'){res.end('SENTINEL_RAW_FAILURE');return;}
    const category=labels[field.text];const found=category&&!field.allowedEntityTypes.includes(category);
    res.end(JSON.stringify({verdict:found?'rejected':'accepted',modelPolicyVersion:caps.engines[name].version,findings:found?[{fieldId:field.fieldId,entityType:category}]:[]}));
   });await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));servers.push(server);urls[name]=`http://127.0.0.1:${server.address().port}`;
  }
  const settings=join(directory,'config.json');const events=join(directory,'events');
  await writeFile(settings,JSON.stringify({urls,events,registry:Object.keys(caps.engines.presidio.mapping),imageIds:{presidio:'sha256:'+'a'.repeat(64),horizon:'sha256:'+'b'.repeat(64)}}));
  const output=join(directory,'results');
  const result=await exec(process.execPath,['--import',hook,cli,'--presidio-image','fake:p','--horizon-image','fake:h','--output-dir',output],{env:{...process.env,COMPARISON_FAKE_CONFIG:settings}}).catch(e=>e);
  const bundle=JSON.parse(await readFile(join(output,'results.json')));
  assert.equal(bundle.runStatus,mode==='complete'?'complete':'incomplete');
  assert.equal(result.code??0,mode==='complete'?0:1);
  const lifecycle=await readFile(events,'utf8');assert.match(lifecycle,/presidio:start\npresidio:stop/);
  if(mode!=='malformed')assert.match(lifecycle,/horizon:start\nhorizon:stop/);
  if(mode==='complete')assert.equal(calls.presidio,plan.detection.length+plan.policy.length+2);
  if(mode==='malformed'){assert.equal(calls.presidio,3);assert.equal(calls.horizon,0);assert.match(result.stderr,/INVALID_RESPONSE/);}
  for(const f of await readdir(output)) {
   const text=await readFile(join(output,f),'utf8');assert.ok(!text.includes('SENTINEL_RAW_FAILURE'));
   assert.ok(plan.detection.every(p=>!text.includes(p.text)),f);
  }
  const rendered=join(directory,'render');
  const rerender=await exec(process.execPath,[cli,'--render',join(output,'results.json'),'--output-dir',rendered]).catch(e=>e);
  assert.equal(rerender.code??0,mode==='complete'?0:1);
  assert.equal(await readFile(join(rendered,'summary.json'),'utf8'),await readFile(join(output,'summary.json'),'utf8'));
 } finally {await Promise.all(servers.map(s=>new Promise(resolve=>s.close(resolve))));await rm(directory,{recursive:true,force:true});}
});
