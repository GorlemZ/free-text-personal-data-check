import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createHandler } from '../../poc-horizon/src/server.mjs';
import { assertAnalyzeResponse, requestFor } from '../contract.mjs';
import { FIELD_IDS, HORIZON_SUPPORTED } from '../catalog.mjs';
import { CATEGORIES } from '../../poc-horizon/src/categories.mjs';

const positive = { verdict: 'rejected', modelPolicyVersion: 'synthetic-policy',
  findings: [{ fieldId: 'description', entityType: 'PERSON' }] };
const valid = () => assertAnalyzeResponse(200, positive, CATEGORIES);

test('response contract accepts exact sorted deduplicated findings; rejects leaks and inconsistent verdict', () => {
  valid();
  for (const body of [{ ...positive, text: 'SENTINELSECRET' },
    { ...positive, findings: [...positive.findings, ...positive.findings] },
    { ...positive, findings: [{ fieldId: 'not-a-field', entityType: 'PERSON' }] },
    { ...positive, findings: [{ fieldId: 'description', entityType: 'UNKNOWN' }] },
    { ...positive, verdict: 'accepted' }]) {
    assert.throws(() => assertAnalyzeResponse(200, body, CATEGORIES),
      { message: 'INVALID_RESPONSE' });
  }
  assert.throws(() => assertAnalyzeResponse(503,
    { code: 'ANALYZER_UNAVAILABLE', findings: [] }, CATEGORIES),
  { message: 'INVALID_RESPONSE' });
  assert.deepEqual(assertAnalyzeResponse(400, { code: 'INVALID_ANALYZE_REQUEST' },
    CATEGORIES), { code: 'INVALID_ANALYZE_REQUEST' });
  assert.equal(FIELD_IDS.length, 11);
  assert.equal(HORIZON_SUPPORTED.size, 10);
});

test('requestFor uses a single field and an explicit unfiltered detector probe', () => {
  const sample = { fieldId: 'description', text: 'Ada Verdi',
    allowedEntityTypes: ['PERSON'] };
  assert.deepEqual(requestFor(sample, []), { fields: [{ fieldId: 'description',
    text: 'Ada Verdi', allowedEntityTypes: [] }] });
  assert.deepEqual(requestFor(sample), { fields: [{ fieldId: 'description',
    text: 'Ada Verdi', allowedEntityTypes: ['PERSON'] }] });
});

test('single-field response cannot attribute a finding to another field or a policy-allowed category', () => {
  assert.throws(() => assertAnalyzeResponse(200,
    { ...positive, findings: [{ fieldId: 'contactName', entityType: 'PERSON' }] },
    CATEGORIES, { fieldId: 'description', allowedEntityTypes: [] }),
  { message: 'INVALID_RESPONSE' });
  assert.throws(() => assertAnalyzeResponse(200, positive, CATEGORIES,
    { fieldId: 'description', allowedEntityTypes: ['PERSON'] }),
  { message: 'INVALID_RESPONSE' });
});

async function withHandler(infer, action, onQueued = () => {}) {
  const server = createServer(createHandler({ infer, ready: async () => ({}), onQueued }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = server.address().port;
    const post = async fields => {
      const res = await fetch(`http://127.0.0.1:${port}/v1/analyze`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fields }), signal: AbortSignal.timeout(5000),
      });
      return { status: res.status, body: await res.json() };
    };
    await action(post);
  } finally { await new Promise(resolve => server.close(resolve)); }
}
const field = (fieldId = 'description') => ({ fieldId, text: 'Testo neutro.',
  allowedEntityTypes: [] });

test('second field technical failure produces no partial verdict or findings', async () => {
  let calls = 0;
  await withHandler(async () => { if (++calls === 2) throw new Error('synthetic'); return [] },
    async post => {
      const { status, body } = await post([field(), field('contactName')]);
      assert.equal(status, 503);
      assert.deepEqual(assertAnalyzeResponse(status, body, CATEGORIES),
        { code: 'ANALYZER_UNAVAILABLE' });
    });
});

test('unknown model label fails closed without leaking any partial findings', async () => {
  await withHandler(async () => [{ entity_group: 'NOT_IN_MODEL', score: 0.99 }],
    async post => {
      const { status, body } = await post([field()]);
      assert.equal(status, 503);
      assert.deepEqual(assertAnalyzeResponse(status, body, CATEGORIES),
        { code: 'ANALYZER_UNAVAILABLE' });
    });
});

test('four held inferences saturate the handler and fifth request is generic 503', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve });
  let fourQueued;
  const queued = new Promise(resolve => { fourQueued = resolve });
  await withHandler(async () => { await gate; return [] },
    async post => {
      const pending = Array.from({ length: 4 }, () => post([field()]));
      await queued; // observed at the exact admission point, without timing heuristics
      try {
        const fifth = await post([field()]);
        assert.equal(fifth.status, 503);
        assert.deepEqual(assertAnalyzeResponse(fifth.status, fifth.body, CATEGORIES),
          { code: 'ANALYZER_UNAVAILABLE' });
      } finally { release(); }
      for (const response of await Promise.all(pending)) {
        assert.equal(response.status, 200);
        assertAnalyzeResponse(response.status, response.body, CATEGORIES);
      }
    }, count => { if (count === 4) fourQueued(); });
});
