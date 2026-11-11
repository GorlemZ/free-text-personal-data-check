import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';

const root = new URL('../', import.meta.url);
test('consolidated literal nine-category gold retains reviewed annotations with no generated-text dependency', async () => {
  assert.deepEqual(TARGET_CATEGORIES, ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE',
    'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']);
  const texts = JSON.parse(await readFile(new URL('corpus.json', root)));
  const rows = JSON.parse(await readFile(new URL('gold.json', root)));
  const plan = await loadCorpus();
  assert.equal(plan.review.status, 'independently-reviewed');
  assert.ok(plan.review.reviewer.trim());
  assert.ok(Number.isFinite(Date.parse(plan.review.reviewedAt)));
  assert.equal(texts.length, 290);
  assert.equal(rows.length, 329);
  assert.ok(rows.every(row => row.annotationStatus === 'independently-reviewed' && row.split === 'evaluation'));
  assert.ok(rows.every(row => Number.isInteger(row.textIndex) && !Object.hasOwn(row, 'text')));
  assert.ok(plan.policy.length > plan.detection.length);
  assert.deepEqual(Object.keys(plan).sort(), ['detection', 'manifest', 'policy', 'review']);
  assert.ok(plan.manifest.limitations.some(x => /prior unreviewed generated draft/i.test(x)));
  assert.ok(plan.manifest.limitations.some(x => /independent qualitative review is complete/i.test(x)));
  const sealedKeys = [];
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      if (/hash|sha256/i.test(key)) sealedKeys.push(key);
      visit(child);
    }
  };
  visit(plan);
  assert.deepEqual(sealedKeys, []);
});

test('each literal has an indexed annotation; policy reuse never adds another input string', async () => {
  const texts = JSON.parse(await readFile(new URL('corpus.json', root)));
  const rows = JSON.parse(await readFile(new URL('gold.json', root)));
  assert.deepEqual([...new Set(rows.map(r => r.textIndex))].sort((a, b) => a - b),
    texts.map((_, i) => i));
  assert.ok(rows.every(r => texts[r.textIndex] === texts[r.textIndex].trim()));
  assert.equal(rows.length - texts.length, 39);
});
