import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { TARGET_CATEGORIES, HORIZON_SUPPORTED } from './catalog.mjs';
import { validateCorpus } from './metrics.mjs';
import { CATEGORIES } from '../poc-horizon/src/categories.mjs';

const corpus = JSON.parse(await readFile(new URL('./corpus.json', import.meta.url), 'utf8'));
test('synthetic corpus covers each of the 18 Presidio categories with a positive and negative/near-miss pair', () => {
  assert.equal(TARGET_CATEGORIES.length, 18);
  assert.ok(validateCorpus(corpus));
  for (const category of TARGET_CATEGORIES) {
    assert.ok(corpus.some(s => s.expectedEntities.includes(category)), `positive: ${category}`);
    assert.ok(corpus.some(s => s.id === `${{
      PERSON: 'person', ORGANIZATION: 'organization', LOCATION: 'location',
      EMAIL_ADDRESS: 'email', PHONE_NUMBER: 'phone', CREDIT_CARD: 'card',
      IP_ADDRESS: 'ip', MAC_ADDRESS: 'mac', URL: 'url', IT_FISCAL_CODE: 'cf',
      IT_DRIVER_LICENSE: 'license', IT_IDENTITY_CARD: 'identity',
      IT_PASSPORT: 'passport', IT_VAT_CODE: 'vat', IBAN_CODE: 'iban',
      CRYPTO: 'crypto', DATE_TIME: 'date', MEDICAL_LICENSE: 'medical',
    }[category]}-negative` && !s.expectedEntities.includes(category)), `negative: ${category}`);
  }
  assert.ok(corpus.every(s => s.text.length > 0));
  assert.equal(HORIZON_SUPPORTED.size, 10);
  assert.ok([...HORIZON_SUPPORTED].every(x => CATEGORIES.has(x)));
  assert.ok(!CATEGORIES.has('IBAN_CODE'));
});
