import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { validateCapabilities, loadCapabilities, freezeTokenLimits, countHorizonTokens } from '../functional/config.mjs';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';

const dir = new URL('../functional/', import.meta.url);

test('descriptive capabilities load independently of gold, approvals and hashes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'functional-config-'));
  try {
    const data = JSON.parse(await readFile(new URL('capabilities.json', dir)));
    delete data.alignmentStatus;
    delete data.frozenBeforePredictions;
    for (const engine of Object.values(data.engines)) {
      delete engine.expectedImageId;
      delete engine.activeRegistryVerified;
    }
    await writeFile(join(directory, 'capabilities.json'), JSON.stringify(data));
    // No manifest/corpus exists in this directory; descriptive config stands alone.
    const c = await loadCapabilities(pathToFileURL(directory + '/'));
    assert.deepEqual(c, data);
    assert.deepEqual(c.sampledCategories, TARGET_CATEGORIES);
    assert.deepEqual(c.unsampledCategories, []);
    assert.equal(c.engines.horizon.mapping.TAX_ID, 'TAX_ID');
    assert.equal(c.engines.horizon.mapping.BANK_ACCOUNT, 'BANK_ACCOUNT');
    for (const e of Object.values(c.engines)) {
      assert.ok(e.version);
      assert.deepEqual(Object.keys(e.capabilities), TARGET_CATEGORIES);
    }
  } finally { await rm(directory, { recursive: true, force: true }); }
});

test('current capabilities contain no approval, registry or expected-image gates', async () => {
  const c = await loadCapabilities();
  for (const key of ['alignmentStatus', 'artifactSha256', 'frozenBeforePredictions'])
    assert.equal(Object.hasOwn(c, key), false, key);
  for (const e of Object.values(c.engines)) {
    assert.equal(Object.hasOwn(e, 'expectedImageId'), false);
    assert.equal(Object.hasOwn(e, 'activeRegistryVerified'), false);
    assert.equal(e.capabilities.PERSON.checksum, 'not applicable');
    assert.equal(e.capabilities.EMAIL_ADDRESS.checksum, 'not applicable');
  }
});

test('rejects false mappings, missing evidence and incomplete support', async () => {
  for (const mutate of [c => c.engines.horizon.mapping.TAX_ID = 'IT_FISCAL_CODE',
    c => delete c.engines.horizon.mapping.EMAIL,
    c => c.engines.horizon.capabilities.IT_VAT_CODE.evidence = [],
    c => delete c.engines.presidio.capabilities.PERSON]) {
    const c = await loadCapabilities();
    mutate(c);
    assert.throws(() => validateCapabilities(c), /INVALID_CAPABILITIES/);
  }
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
