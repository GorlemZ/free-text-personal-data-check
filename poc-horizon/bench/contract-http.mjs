// Same black-box HTTP checks against both real container images; no model mocking.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';

const images = process.argv.slice(2);
if (images.length !== 2) throw new Error('Usage: node bench/contract-http.mjs SPACY_IMAGE HORIZON_IMAGE');
const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',timeout:180000}).trim();
async function check(image) {
  const name = `poc-contract-${randomUUID().slice(0,8)}`;
  const id = docker('run','-d','--name',name,'--memory=4g','--memory-swap=4g',
    '-e','ANALYZER_BIND_HOST=0.0.0.0','-p','127.0.0.1::8000',image);
  let checks=0;
  try {
    const port = docker('port',id,'8000/tcp').match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) throw Error('Port not loopback');
    const url=`http://127.0.0.1:${port}`;
    let ready=false;
    for (let i=0;i<120;i++) {
      try { const r=await fetch(url+'/health/ready'); if (r.status===200 &&
        (await r.json()).status==='ready') { ready=true; break; } } catch {}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(ready,'Model not ready'); checks++;
    async function send(body) {
      const r=await fetch(url+'/v1/analyze',{method:'POST',
        headers:{'Content-Type':'application/json'},body});
      return {status:r.status,text:await r.text()};
    }
    const field=(text,fieldId='description')=>({fieldId,text,allowedEntityTypes:[]});
    const neutral=await send(JSON.stringify({fields:[field('Servizio digitale.')] }));
    assert.equal(neutral.status,200);
    assert.deepEqual(Object.keys(JSON.parse(neutral.text)).sort(),
      ['findings','modelPolicyVersion','verdict']);
    assert.equal(JSON.parse(neutral.text).verdict,'accepted'); checks++;
    const email=await send(JSON.stringify({fields:[field('mario.rossi@example.com')]}));
    assert.equal(email.status,200);
    assert.equal(JSON.parse(email.text).verdict,'rejected');
    assert.ok(JSON.parse(email.text).findings.some(x=>x.entityType==='EMAIL_ADDRESS'));
    assert.ok(!email.text.includes('mario.rossi')); checks++;
    for (const body of [JSON.stringify({fields:[]}),
      '{"fields":[],"fields":[{"fieldId":"description","text":"SENTINELSECRET","allowedEntityTypes":[]}]}']) {
      const r=await send(body); assert.equal(r.status,400);
      assert.deepEqual(JSON.parse(r.text),{code:'INVALID_ANALYZE_REQUEST'});
      assert.ok(!r.text.includes('SENTINELSECRET')); checks++;
    }
    // Both implementations must reject malformed UTF-8 rather than analyze altered input.
    const r=await send(Buffer.concat([Buffer.from('{"fields":[{"fieldId":"description","text":"'),
      Buffer.from([0xff]),Buffer.from('","allowedEntityTypes":[]}]}')]));
    assert.equal(r.status,400); checks++;
    return {image,checks,status:'pass'};
  } finally { docker('rm','-f',id); }
}
for (const image of images) console.log(JSON.stringify(await check(image)));
