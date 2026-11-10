import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';
test('one pending-review seven-category corpus replaces split gold', async () => {
 assert.deepEqual(TARGET_CATEGORIES, ['PERSON','EMAIL_ADDRESS','PHONE_NUMBER','IT_FISCAL_CODE','IT_VAT_CODE','IBAN_CODE','CREDIT_CARD']);
 const plan = await loadCorpus();
 assert.equal(plan.review.status, 'pending');
 assert.ok(plan.policy.length > plan.detection.length);
 assert.deepEqual(Object.keys(plan.corpusHashes), ['gold']);
});
