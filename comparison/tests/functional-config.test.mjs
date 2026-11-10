import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateCapabilities, loadCapabilities, freezeTokenLimits, countHorizonTokens,
  verifyActivePresidioRegistry } from '../functional/config.mjs';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';

const dir = new URL('../functional/', import.meta.url);

test('seven axes use configurable versions and preserve native mapping without generic remapping', async () => {
 const c=await loadCapabilities(); assert.deepEqual(c.sampledCategories,TARGET_CATEGORIES); assert.deepEqual(c.unsampledCategories,[]);
 assert.equal(c.alignmentStatus,'pending');
 for(const e of Object.values(c.engines)) { assert.equal(e.expectedImageId,null); assert.ok(e.version); assert.deepEqual(Object.keys(e.capabilities),TARGET_CATEGORIES); }
 assert.equal(c.engines.horizon.mapping.TAX_ID,'TAX_ID');
 const changed=structuredClone(c); changed.engines.horizon.version='future-reviewed-policy'; assert.doesNotThrow(()=>validateCapabilities(changed));
});
test('rejects false mappings, missing evidence and incomplete support', async()=>{
 for(const mutate of [c=>c.engines.horizon.mapping.TAX_ID='IT_FISCAL_CODE', c=>delete c.engines.horizon.mapping.EMAIL,
 c=>c.engines.horizon.capabilities.IT_VAT_CODE.evidence=[],c=>delete c.engines.presidio.capabilities.PERSON,
 c=>c.engines.presidio.expectedImageId='tag:not-digest']) {
 const c=await loadCapabilities(); mutate(c); assert.throws(()=>validateCapabilities(c),/INVALID_CAPABILITIES/);
 }
});
test('capability bytes are bound by the manifest; registry is a separate runtime gate',async()=>{
 const c=await loadCapabilities(); const bytes=await readFile(new URL('capabilities.json',dir));
 assert.equal(c.artifactSha256,createHash('sha256').update(bytes).digest('hex'));
 assert.deepEqual(verifyActivePresidioRegistry(c,TARGET_CATEGORIES),TARGET_CATEGORIES);
 assert.throws(()=>verifyActivePresidioRegistry(c,TARGET_CATEGORIES.slice(1)),/UNVERIFIED_PRESIDIO_REGISTRY/);
 assert.throws(()=>verifyActivePresidioRegistry(c,[...TARGET_CATEGORIES,'NRP']),/UNVERIFIED_PRESIDIO_REGISTRY/);
});
test('real local Horizon tokenizer preflight measures every corpus text without inference', async () => {
  const plan = await loadCorpus();
  const frozen = await freezeTokenLimits(plan, countHorizonTokens);
  assert.equal(frozen.detection.length, plan.detection.length);
  assert.ok(frozen.detection.every(x => x.tokenCount > 0 && Number.isSafeInteger(x.tokenCount)));
  assert.ok(frozen.policy.every(x => x.tokenCount === frozen.detection.find(d => d.sourceIds.includes(x.id)).tokenCount));
  assert.equal(frozen.detection[0].tokenCount, await countHorizonTokens(frozen.detection[0].text,
    { truncation: false, padding: false }));
});
test('token preflight freezes normal/challenge for every unique text before predictions', async () => {
  const plan = await loadCorpus();
  let count = 0;
  const frozen = await freezeTokenLimits(plan, async () => { count++; return count === 1 ? 513 : 512; });
  assert.equal(count, plan.detection.length);
  assert.equal(frozen.detection.filter(x => x.limitChallenge).length, 1);
  assert.equal(frozen.policy.filter(x => x.limitChallenge).length, plan.detection[0].sourceIds.length);
  assert.ok(frozen.policy.every(x => x.tokenCount === frozen.detection.find(d => d.sourceIds.includes(x.id)).tokenCount));
  assert.equal(plan.detection[0].limitChallenge, undefined);
  assert.notEqual(frozen.detection[0].text, undefined);
});
test('preflight fails closed on missing or invalid tokenizer measurement', async () => {
  const plan = await loadCorpus();
  await assert.rejects(freezeTokenLimits(plan, async () => NaN), /INVALID_TOKEN_COUNT/);
});
