// Same black-box HTTP checks against real container images; no model mocking.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { CATEGORIES } from '../../../poc-horizon/dist/analysis/contracts.mjs';

export function expectedEmailEntityType(engine) {
  if (['presidio', 'horizon', 'rizzo'].includes(engine)) return 'EMAIL_ADDRESS';
  throw new Error(`Unknown engine: ${engine}`);
}
const docker = (...args) => execFileSync('docker',args,{encoding:'utf8',timeout:180000}).trim();
export async function check(image, engine, { docker:runDocker=docker, fetch:request=fetch } = {}) {
  expectedEmailEntityType(engine); // Validate the engine name, not prediction quality.
  const name = `poc-contract-${randomUUID().slice(0,8)}`;
  const id = runDocker('run','-d','--name',name,'--memory=4g','--memory-swap=4g',
    '-e','ANALYZER_BIND_HOST=0.0.0.0','-p','127.0.0.1::8000',image);
  let checks=0;
  try {
    const port = runDocker('port',id,'8000/tcp').match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) throw Error('Port not loopback');
    const url=`http://127.0.0.1:${port}`;
    let ready=false;
    for (let i=0;i<120;i++) {
      try { const r=await request(url+'/health/ready'); if (r.status===200 &&
        (await r.json()).status==='ready') { ready=true; break; } } catch {}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    assert.ok(ready,'Model not ready'); checks++;
    async function send(body) {
      const r=await request(url+'/v1/analyze',{method:'POST',
        headers:{'Content-Type':'application/json'},body});
      return {status:r.status,text:await r.text()};
    }
    const field=(text,fieldId='description')=>({fieldId,text,allowedCategories:[]});
    for (const text of ['Servizio digitale.', 'mario.rossi@example.com']) {
      const response = await send(JSON.stringify({ fields: [field(text)] }));
      assert.equal(response.status, 200);
      const result = JSON.parse(response.text);
      assert.deepEqual(Object.keys(result).sort(), ['findings', 'verdict']);
      assert.ok(Array.isArray(result.findings));
      assert.equal(result.verdict, result.findings.length ? 'rejected' : 'accepted');
      let previous;
      for (const finding of result.findings) {
        assert.deepEqual(Object.keys(finding).sort(), ['category', 'fieldId']);
        assert.equal(finding.fieldId, 'description');
        assert.ok(CATEGORIES.has(finding.category));
        assert.ok(previous === undefined || previous < finding.category);
        previous = finding.category;
      }
      assert.ok(!response.text.includes('mario.rossi'));
      checks++;
    }
    for (const body of [JSON.stringify({fields:[]}),
      '{"fields":[],"fields":[{"fieldId":"description","text":"SENTINELSECRET","allowedCategories":[]}]}']) {
      const r=await send(body); assert.equal(r.status,400);
      assert.deepEqual(JSON.parse(r.text),{code:'invalid_request'});
      assert.ok(!r.text.includes('SENTINELSECRET')); checks++;
    }
    // Both implementations must reject malformed UTF-8 rather than analyze altered input.
    const r=await send(Buffer.concat([Buffer.from('{"fields":[{"fieldId":"description","text":"'),
      Buffer.from([0xff]),Buffer.from('","allowedCategories":[]}]}')]));
    assert.equal(r.status,400); checks++;
    return {image,checks,status:'pass'};
  } finally { runDocker('rm','-f',id); }
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const images = process.argv.slice(2);
  if (images.length !== 3) throw new Error('Usage: node tests/bench/horizon/contract-http.mjs PRESIDIO_IMAGE HORIZON_IMAGE RIZZO_IMAGE');
  for (const [index, engine] of ['presidio','horizon','rizzo'].entries())
    console.log(JSON.stringify(await check(images[index], engine)));
}
