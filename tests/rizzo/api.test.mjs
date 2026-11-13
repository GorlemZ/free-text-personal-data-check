import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { createServer } from './support/http.mjs';

async function withServer(detect, run) {
  const server = createServer({ detect });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}`;
  try { await run(base); } finally { await new Promise(resolve => server.close(resolve)); }
}
async function post(base, payload, raw = false) {
  const response = await fetch(`${base}/v1/analyze`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: raw ? payload : JSON.stringify(payload),
  });
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8');
  return { status: response.status, body: await response.json() };
}
const field = (text = '', fieldId = 'arbitrary/id') => ({ fieldId, text });

test('requires application/json before any detection',async()=>{
 await withServer(async()=>{throw new Error('must not run');},async base=>{
   const response=await fetch(`${base}/v1/analyze`,{method:'POST',headers:{'content-type':'text/plain'},body:JSON.stringify({fields:[field()]})});
   assert.equal(response.status,400);assert.deepEqual(await response.json(),{code:'invalid_request'});
 });
});

test('readiness and route isolation do not invoke detector', async () => {
  await withServer(async () => { throw new Error('must not run'); }, async base => {
    const ready = await fetch(`${base}/health/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });
    const missing = await fetch(`${base}/elsewhere`);
    assert.equal(missing.status, 404);
    assert.deepEqual(await missing.json(), { code: 'not_found' });
  });
});

test('returns only forbidden category pairs, sorted and deduplicated per field', async () => {
  await withServer(async () => new Set(['PHONE_NUMBER', 'PERSON', 'EMAIL_ADDRESS']), async base => {
    assert.deepEqual(await post(base, { fields: [
      { ...field('private synthetic text', 'z'), allowedCategories: ['PERSON', 'PERSON'] },
      { ...field('private synthetic text', 'a'), allowedCategories: [] },
    ] }), { status: 200, body: { verdict: 'rejected', findings: [
      { fieldId: 'a', category: 'EMAIL_ADDRESS' },
      { fieldId: 'a', category: 'PERSON' },
      { fieldId: 'a', category: 'PHONE_NUMBER' },
      { fieldId: 'z', category: 'EMAIL_ADDRESS' },
      { fieldId: 'z', category: 'PHONE_NUMBER' },
    ] } });
    assert.deepEqual(await post(base, { fields: [{ ...field(), allowedCategories: ['PERSON', 'PHONE_NUMBER', 'EMAIL_ADDRESS'] }] }),
      { status: 200, body: { verdict: 'accepted', findings: [] } });
  });
});

test('validates the entire closed request before any detector call', async () => {
  let calls = 0;
  await withServer(async () => { calls++; return new Set(); }, async base => {
    const invalid = [null, [], {}, { fields: [] }, { fields: Array.from({ length: 11 }, (_, i) => field('', String(i))) },
      { fields: [field()], extra: true }, { fields: [null] }, { fields: [{ ...field(), extra: true }] },
      { fields: [{ text: '' }] }, { fields: [{ fieldId: 'x' }] }, { fields: [field('', '')] },
      { fields: [field('', 'x'.repeat(129))] }, { fields: [field(1)] }, { fields: [field('', 1)] },
      { fields: [field('', 'same'), field('', 'same')] },
      ...[null, 'PERSON', [1], ['UNKNOWN'], ['person']].map(allowedCategories => ({ fields: [{ ...field(), allowedCategories }] })),
      { fields: [field('word\u0085'.repeat(51))] },
      { fields: [field('safe', 'first'), { ...field('private', 'second'), allowedCategories: ['UNKNOWN'] }] },
    ];
    for (const payload of invalid) assert.deepEqual(await post(base, payload), { status: 400, body: { code: 'invalid_request' } });
    assert.equal(calls, 0);
    for (const text of ['', 'word\u0085'.repeat(50), 'word\u00a0'.repeat(50), 'word\u2028'.repeat(50)]) {
      assert.equal((await post(base, { fields: [field(text)] })).status, 200);
    }
    assert.equal((await post(base, { fields: Array.from({ length: 10 }, (_, i) => field('', String(i))) })).status, 200);
    assert.equal((await post(base, { fields: [field('', 'x'.repeat(128))] })).status, 200);
  });
});

test('rejects malformed JSON and duplicate decoded keys without echoing input', async () => {
  let calls = 0;
  await withServer(async () => { calls++; return new Set(); }, async base => {
    for (const raw of [
      '{"fields":[],"fields":[{"fieldId":"x","text":"secret"}]}',
      '{"fields":[{"fieldId":"x","text":"secret","te\\u0078t":""}]}',
      '{"fields":[{"fieldId":"x","fieldId":"y","text":""}]}',
      '{"fields":[{"fieldId":"x","text":"","allowedCategories":[],"allowedCategories":["PERSON"]}]}',
      '{"private":', '', '[', 'null trailing',
    ]) assert.deepEqual(await post(base, raw, true), { status: 400, body: { code: 'invalid_request' } });
    assert.equal(calls, 0);
    assert.equal((await post(base, { fields: [field('text: { \\"fields\\": 1, \\"fields\\": 2 } \\')] })).status, 200);
  });
});

test('fails closed on detector exceptions or an invalid detector result', async () => {
  for (const bad of [() => { throw new Error('SENSITIVE_SENTINEL'); }, () => ['PERSON'], () => new Set(['UNKNOWN'])]) {
    let calls = 0;
    await withServer(async () => ++calls === 1 ? new Set(['PERSON']) : bad(), async base => {
      assert.deepEqual(await post(base, { fields: [field('private', 'a'), field('private', 'b')] }),
        { status: 503, body: { code: 'detector_unavailable' } });
    });
  }
});

test('enforces the 1 MiB byte limit and strict UTF-8 before detection', async () => {
  let calls = 0;
  await withServer(async () => { calls++; return new Set(); }, async base => {
    const overhead = Buffer.byteLength(JSON.stringify({ fields: [field('')] }));
    assert.equal((await post(base, { fields: [field('x'.repeat(1024 * 1024 - overhead))] })).status, 200);
    calls = 0;
    for (const raw of [JSON.stringify({ fields: [field('x'.repeat(1024 * 1024))] }),
      JSON.stringify({ fields: [field('è'.repeat(600000))] })]) {
      assert.deepEqual(await post(base, raw, true), { status: 413, body: { code: 'body_too_large' } });
    }
    const raw = Buffer.concat([Buffer.from('{"fields":[{"fieldId":"x","text":"'), Buffer.from([0xff]), Buffer.from('"}]}')]);
    assert.deepEqual(await post(base, raw, true), { status: 400, body: { code: 'invalid_request' } });
    assert.equal(calls, 0);
  });
});

test('rejects unpaired surrogates before detection, preserving non-BMP IDs',async()=>{
 let calls=0;
 await withServer(async()=>{calls++;return new Set(['PERSON']);},async base=>{
   for(const payload of [{fields:[field('\ud800')]},{fields:[field('', '\udc00')]}]) {
     assert.deepEqual(await post(base,payload),{status:400,body:{code:'invalid_request'}});
   }
   assert.equal(calls,0);
   assert.deepEqual((await post(base,{fields:[field('', '\ue000'),field('', '😀')]})).body.findings,
     [{fieldId:'😀',category:'PERSON'},{fieldId:'\ue000',category:'PERSON'}]);
 });
});
test('readiness and detection are unavailable without bypassing validation',async()=>{
 let calls=0;
 const server=createServer({detect:async()=>{calls++;return new Set();},ready:()=>false});
 server.listen(0,'127.0.0.1');await once(server,'listening');
 const base=`http://127.0.0.1:${server.address().port}`;
 try {
   const ready=await fetch(`${base}/health/ready`);assert.equal(ready.status,503);assert.deepEqual(await ready.json(),{code:'detector_unavailable'});
   assert.deepEqual(await post(base,{fields:[]}),{status:400,body:{code:'invalid_request'}});
   assert.deepEqual(await post(base,{fields:[field()]}),{status:503,body:{code:'detector_unavailable'}});
   assert.equal(calls,0);
 } finally {await new Promise(resolve=>server.close(resolve));}
});
test('accepts a valid empty field through a real HTTP socket', async () => {
  const calls = [];
  await withServer(async text => { calls.push(text); return new Set(); }, async base => {
    assert.deepEqual(await post(base, { fields: [field()] }), {
      status: 200, body: { verdict: 'accepted', findings: [] },
    });
  });
  assert.deepEqual(calls, ['']);
});
