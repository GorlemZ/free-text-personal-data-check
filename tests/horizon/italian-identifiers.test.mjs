import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vatCategories, validItalianVat } from '../../poc-horizon/dist/recognizers/vat.js';
import { italianIbanCategories } from '../../poc-horizon/dist/recognizers/italian-iban.js';

test('all-zero VAT is an invalid placeholder despite matching the checksum', () => {
  assert.equal(validItalianVat('00000000000'), false);
  assert.equal(validItalianVat('IT00000000000'), false);
});

const vat = '12345678903'; // Synthetic string; shape only, no claim of assignment.
const iban = 'IT60X0542811101000000123456'; // Synthetic, shape only.

test('Italian VAT with valid checksum is matched without context', () => {
  const text = `🙂${vat} oppure IT${vat}`;
  const matches = vatCategories(text);
  assert.deepEqual(matches, new Set(['IT_VAT_CODE']));
  assert.deepEqual(vatCategories(`x${vat}`), new Set());
  assert.deepEqual(vatCategories(`${vat}9`), new Set());
  assert.deepEqual(vatCategories(`ıt${vat}`), new Set());
});

test('Italian IBAN checksum, flexible spacing, emoji prefix and boundaries', () => {
  const text = `🙂${iban}`;
  assert.deepEqual(italianIbanCategories(text), new Set(['IBAN_CODE']));
  assert.deepEqual(italianIbanCategories('IT60 X054 2811 1010 0000 0123 456'), new Set(['IBAN_CODE']));
  assert.equal(italianIbanCategories(`${iban}Z`).size, 0);
  assert.equal(italianIbanCategories('IT60K0542811101000000123456').size, 0);
  assert.deepEqual(italianIbanCategories('IT00X0542811101000000123456'), new Set());
});
