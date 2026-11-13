import { test } from 'node:test';
import assert from 'node:assert/strict';
import { vatCandidates, validItalianVat } from '../../poc-horizon/dist/recognizers/vat.js';
import { italianIbanCandidates } from '../../poc-horizon/dist/recognizers/italian-iban.js';

test('all-zero VAT is an invalid placeholder despite matching the checksum', () => {
  assert.equal(validItalianVat('00000000000'), false);
  assert.equal(validItalianVat('IT00000000000'), false);
});

const vat = '12345678903'; // Synthetic string; shape only, no claim of assignment.
const iban = 'IT60X0542811101000000123456'; // Synthetic, shape only.

test('Italian VAT with valid checksum is matched without context', () => {
  const text = `🙂${vat} oppure IT${vat}`;
  const matches = vatCandidates(text);
  assert.deepEqual(matches.map(({ start, end }) => [start, end]), [[2, 13], [21, 34]]);
  assert.ok(matches.every(x => x.category === 'IT_VAT_CODE' && x.check === 'passed'));
  assert.deepEqual(vatCandidates(`x${vat}`), []);
  assert.deepEqual(vatCandidates(`${vat}9`), []);
  assert.deepEqual(vatCandidates(`ıt${vat}`), []);
});

test('Italian IBAN checksum, flexible spacing, UTF-16 offset and boundaries', () => {
  const text = `🙂${iban}`;
  const [match] = italianIbanCandidates(text);
  assert.equal(match.start, 2);
  assert.equal(match.end, 29);
  assert.equal(match.category, 'IBAN_CODE');
  assert.equal(match.check, 'passed');
  assert.equal(italianIbanCandidates(`${iban}Z`).length, 0);
  assert.equal(italianIbanCandidates('IT60K0542811101000000123456').length, 0);
  assert.equal(italianIbanCandidates('IT00X0542811101000000123456')[0].check, 'failed');
});
