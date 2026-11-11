import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeToGold, expandAllowlist, projectFindings, validateCategoryMap } from '../functional/category-map.mjs';

const nine = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'];
test('one complete unambiguous native map expands all nine and deduplicates phone', () => {
  assert.deepEqual(Object.values(nativeToGold.presidio), nine);
  assert.deepEqual(expandAllowlist('presidio', nine), nine);
  assert.deepEqual(expandAllowlist('horizon', nine), ['PERSON', 'EMAIL', 'PHONE', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'NATIONAL_ID', 'DRIVER_LICENSE']);
  assert.deepEqual(projectFindings('horizon', ['PHONE', 'PHONE_NUMBER', 'NATIONAL_ID']), ['PHONE_NUMBER', 'IT_IDENTITY_CARD']);
  for (const alias of ['LICENSE_NUMBER', 'TAX_ID', 'BANK_ACCOUNT']) assert.equal(nativeToGold.horizon[alias], undefined);
});
test('mapping rejects unknown semantics, ambiguous aliases and missing category', () => {
  assert.throws(() => expandAllowlist('horizon', ['LICENSE_NUMBER']), /INVALID_CATEGORY_MAP/);
  assert.throws(() => projectFindings('horizon', ['LICENSE_NUMBER']), /INVALID_CATEGORY_MAP/);
  for (const mutate of [m => { m.horizon.PHONE = 'PERSON'; }, m => { delete m.presidio.IT_DRIVER_LICENSE; }, m => { m.horizon.LICENSE_NUMBER = 'IT_DRIVER_LICENSE'; }]) {
    const map = structuredClone(nativeToGold); mutate(map);
    assert.throws(() => validateCategoryMap(map), /INVALID_CATEGORY_MAP/);
  }
});
