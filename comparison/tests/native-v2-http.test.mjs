import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { collectBundle } from '../functional/collect.mjs';
import { analyzeBundle, validateReleaseBundle } from '../functional/metrics.mjs';
import { renderReport } from '../functional/report.mjs';
import { loadCapabilities } from '../functional/config.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';

const gold = { detection: [{ detectionCaseId: 'd1', sourceIds: ['p1','p2','p3','p4'], fieldId: 'description', text: 'PRIVATE_INPUT', expectedEntities: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], split: 'evaluation', familyId: 'family', strata: [1,2,3,4].map(n => ({ sourceId: `p${n}`, focusCategory: 'PHONE_NUMBER', scenario: 'positive' })) }], policy: [
  { id: 'p1', fieldId: 'description', text: 'PRIVATE_INPUT', expectedEntities: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], allowedEntityTypes: ['PHONE_NUMBER'], expectedVerdict: 'rejected' },
  { id: 'p2', fieldId: 'description', text: 'PRIVATE_INPUT', expectedEntities: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], allowedEntityTypes: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], expectedVerdict: 'accepted' },
  { id: 'p3', fieldId: 'description', text: 'PRIVATE_INPUT', expectedEntities: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], allowedEntityTypes: ['PERSON'], expectedVerdict: 'rejected' },
  { id: 'p4', fieldId: 'description', text: 'PRIVATE_INPUT', expectedEntities: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], allowedEntityTypes: TARGET_CATEGORIES, expectedVerdict: 'accepted' },
] };
const aliases = { presidio: ['PERSON','PHONE_NUMBER','IT_IDENTITY_CARD'], horizon: ['PERSON','PHONE','PHONE_NUMBER','NATIONAL_ID'] };
async function withFake(fn, mutate = () => {}) {
  const servers = []; const calls = {presidio:[],horizon:[]}; const urls = {};
  try {
    for (const engine of ['presidio','horizon']) {
      const server = createServer(async(req,res) => {
        const chunks=[]; for await(const c of req) chunks.push(c);
        const body=JSON.parse(Buffer.concat(chunks)); calls[engine].push(body);
        const field=body.fields[0];
        const findings=aliases[engine].filter(label => !field.allowedEntityTypes.includes(label))
          .map(entityType => ({fieldId:field.fieldId,entityType})).sort((a,b)=>a.entityType.localeCompare(b.entityType,'en'));
        const response={verdict:findings.length?'rejected':'accepted',modelPolicyVersion:'v2',findings};
        const altered=mutate(engine,field,response,calls[engine].length);
        res.writeHead(altered?.status??200,{'content-type':'application/json'});
        res.end(JSON.stringify(altered?.body??response));
      });
      await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve)); servers.push(server);
      urls[engine]=`http://127.0.0.1:${server.address().port}`;
    }
    return await fn({calls,urls});
  } finally { await Promise.all(servers.map(server=>new Promise(resolve=>server.close(resolve)))); }
}
const collect = async urls => collectBundle({ plan:gold, capabilities:await loadCapabilities(), urls,
  policyVersions:{presidio:'v2',horizon:'v2'} });

test('real HTTP collector expands native allowlists and scores deduplicated findings with original verdict', async () => {
  await withFake(async ({calls,urls}) => {
    const b=await collect(urls);
    assert.equal(b.schemaVersion,2);
    assert.deepEqual(b.policyUnits[0].nativeAllowedEntityTypes.horizon,['PHONE','PHONE_NUMBER']);
    assert.deepEqual(b.policyUnits[3].nativeAllowedEntityTypes.horizon,
      ['PERSON','EMAIL','PHONE','PHONE_NUMBER','IT_FISCAL_CODE','IT_VAT_CODE','IBAN_CODE','CREDIT_CARD','NATIONAL_ID','DRIVER_LICENSE']);
    assert.equal(b.policyUnits[3].nativeAllowedEntityTypes.presidio.length,9);
    assert.deepEqual(calls.horizon.map(x=>x.fields[0].allowedEntityTypes),[[],['PHONE','PHONE_NUMBER'],['PERSON','PHONE','PHONE_NUMBER','NATIONAL_ID'],['PERSON'],b.policyUnits[3].nativeAllowedEntityTypes.horizon]);
    assert.deepEqual(b.observations.horizon.detection.d1.categories,[...aliases.horizon].sort((a,b)=>a.localeCompare(b,'en')));
    assert.equal(b.observations.horizon.policy.p1.verdict,'rejected');
    const s=analyzeBundle(b);
    assert.equal(s.schemaVersion,2);
    assert.equal(s.detection.own.horizon.byCategory.PHONE_NUMBER.counts.tp,1);
    assert.equal(s.detection.own.horizon.byCategory.IT_IDENTITY_CARD.counts.tp,1);
    assert.equal(s.policy.own.horizon.counts.tp,2);
    assert.match(renderReport(s).markdown,/Evaluation sample/);
    assert.match(renderReport(s).markdown,/nine-category/);
    assert.equal(validateReleaseBundle(b,gold),b);
    assert.doesNotMatch(JSON.stringify(b), /PRIVATE_INPUT|"text"|"findings"/);
  });
});

test('unknown native label and unexpected 400 become contract failures, never false negatives', async () => {
  for (const change of [
    (engine,field,response,n)=>engine==='horizon'&&n===1?{body:{...response,findings:[{fieldId:field.fieldId,entityType:'LICENSE_NUMBER'}]}}:null,
    (engine,field,response,n)=>engine==='horizon'&&n===1?{status:400,body:{code:'INVALID_ANALYZE_REQUEST'}}:null,
  ]) await withFake(async ({urls}) => {
    const error=await collect(urls).catch(e=>e);
    assert.ok(error instanceof Error);
    assert.equal(error.bundle.observations.horizon.detection.d1.status,'contract-error');
    assert.equal(analyzeBundle(error.bundle).coverage.horizon.detection.contractErrors,1);
  },change);
});

test('standalone v2 snapshot rejects altered native policy and unsafe observation without current gold', async () => {
  await withFake(async ({urls})=>{
    const b=await collect(urls);
    for (const change of [x=>x.observations.horizon.detection.d1.categories.push('LICENSE_NUMBER'),
      x=>x.policyUnits[0].nativeAllowedEntityTypes.horizon.pop(),
      x=>x.capabilities.engines.horizon.mapping.PHONE='PERSON',
      x=>x.policyUnits[0].allowedEntityTypes=['LICENSE_NUMBER'],
      x=>x.observations.horizon.policy.p2.raw='PRIVATE_INPUT']) {
      const x=structuredClone(b); change(x);
      assert.throws(()=>validateReleaseBundle(x),/INVALID_BUNDLE/);
    }
  });
});
test('standalone v2 rejects a self-consistent native-to-semantic swap', async () => {
  await withFake(async ({urls}) => {
    const b = structuredClone(await collect(urls));
    assert.equal(validateReleaseBundle(b), b);
    const map = b.capabilities.engines.horizon.mapping;
    [map.PHONE, map.IT_VAT_CODE] = [map.IT_VAT_CODE, map.PHONE];
    for (const unit of b.policyUnits) unit.nativeAllowedEntityTypes.horizon =
      Object.entries(map).filter(([, semantic]) => unit.allowedEntityTypes.includes(semantic))
        .map(([native]) => native);
    assert.throws(() => validateReleaseBundle(b), /INVALID_BUNDLE/);
  });
});
test('standalone v2 requires the original HTTP verdict on successful detection', async () => {
  await withFake(async ({urls}) => {
    const b = await collect(urls);
    assert.equal(validateReleaseBundle(b), b);
    for (const engine of ['presidio', 'horizon']) {
      const missing = structuredClone(b);
      delete missing.observations[engine].detection.d1.verdict;
      assert.throws(() => validateReleaseBundle(missing), /INVALID_BUNDLE/);
    }
  });
});
test('release gate rejects type-valid frozen metadata drift without a hash', async () => {
  await withFake(async({urls})=>{
    const b=await collect(urls);
    for(const mutate of [x=>x.detectionUnits[0].split='development',
      x=>x.detectionUnits[0].familyId='otherfamily',
      x=>x.detectionUnits[0].strata[0].scenario='negative',
      x=>x.policyUnits[0].focusCategory='PERSON']) {
      const x=structuredClone(b);mutate(x);
      assert.throws(()=>validateReleaseBundle(x,gold),/INVALID_BUNDLE/);
    }
  });
});
test('standalone v1 reader cannot relabel a nine-category v2 run as historical', async () => {
  await withFake(async({urls})=>{
    const x=structuredClone(await collect(urls));x.schemaVersion=1;
    for(const p of x.policyUnits) delete p.nativeAllowedEntityTypes;
    for(const name of ['horizon','presidio']) {
      const map=x.capabilities.engines[name].mapping;
      for(const probe of ['detection','policy']) for(const observation of Object.values(x.observations[name][probe]))
        observation.categories=[...new Set(observation.categories.map(label=>map[label]))];
      delete x.capabilities.engines[name].mapping;
    }
    assert.throws(()=>validateReleaseBundle(x),/INVALID_BUNDLE/);
  });
});
test('standalone v2 rejects coordinated semantic relabeling against the frozen reader contract', async () => {
  await withFake(async({urls})=>{
    const x=structuredClone(await collect(urls));
    const renamed=v=>v==='PHONE_NUMBER'?'PHONE_LEGACY':v;
    x.capabilities.categories=x.capabilities.categories.map(renamed);
    for(const e of ['presidio','horizon']) {
      x.capabilities.engines[e].supportedCategories=x.capabilities.engines[e].supportedCategories.map(renamed);
      for(const k of Object.keys(x.capabilities.engines[e].mapping))
        x.capabilities.engines[e].mapping[k]=renamed(x.capabilities.engines[e].mapping[k]);
    }
    for(const d of x.detectionUnits) { d.expectedEntities=d.expectedEntities.map(renamed);
      for(const s of d.strata) s.focusCategory=renamed(s.focusCategory); }
    for(const p of x.policyUnits) {p.expectedEntities=p.expectedEntities.map(renamed);
      p.allowedEntityTypes=p.allowedEntityTypes.map(renamed);}
    assert.throws(()=>validateReleaseBundle(x),/INVALID_BUNDLE/);
    assert.throws(()=>validateReleaseBundle(x,gold),/INVALID_BUNDLE/);
  });
});
test('HTTP email and licence policy use each service native vocabulary', async()=>{
  const input={detection:[{detectionCaseId:'d2',sourceIds:['p1'],fieldId:'description',
    text:'PRIVATE_INPUT',expectedEntities:['EMAIL_ADDRESS','IT_DRIVER_LICENSE'],split:'evaluation',
    strata:[{sourceId:'p1',focusCategory:'IT_DRIVER_LICENSE',scenario:'positive'}]}],
    policy:[{id:'p1',fieldId:'description',text:'PRIVATE_INPUT',
      expectedEntities:['EMAIL_ADDRESS','IT_DRIVER_LICENSE'],allowedEntityTypes:['EMAIL_ADDRESS'],
      expectedVerdict:'rejected'}]};
  await withFake(async({calls,urls})=>{
    const b=await collectBundle({plan:input,capabilities:await loadCapabilities(),urls,
      policyVersions:{presidio:'v2',horizon:'v2'}});
    assert.deepEqual(calls.presidio[1].fields[0].allowedEntityTypes,['EMAIL_ADDRESS']);
    assert.deepEqual(calls.horizon[1].fields[0].allowedEntityTypes,['EMAIL']);
    assert.deepEqual(b.observations.horizon.detection.d2.categories,['DRIVER_LICENSE','EMAIL']);
    assert.deepEqual(b.observations.presidio.policy.p1.categories,['IT_DRIVER_LICENSE']);
    assert.equal(analyzeBundle(b).detection.paired.horizon.byCategory.IT_DRIVER_LICENSE.counts.tp,1);
  },(engine,field,response)=>{
    const labels=engine==='horizon'?['DRIVER_LICENSE','EMAIL']:['EMAIL_ADDRESS','IT_DRIVER_LICENSE'];
    const findings=labels.filter(entityType=>!field.allowedEntityTypes.includes(entityType))
      .map(entityType=>({fieldId:field.fieldId,entityType}));
    return {body:{...response,verdict:findings.length?'rejected':'accepted',findings}};
  });
});
