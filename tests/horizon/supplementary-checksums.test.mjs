import test from 'node:test';
import assert from 'node:assert/strict';
import { validFiscalCode } from '../../poc-horizon/dist/recognizers/fiscal-code.js';
import { validItalianVat } from '../../poc-horizon/dist/recognizers/vat.js';
import { validItalianIban } from '../../poc-horizon/dist/recognizers/italian-iban.js';

test('CF checksum accepts exactly the expected check letter, independently on repeated calls', () => {
  for (const prefix of ['RSSMRA85M01H501', 'rssmra85m01h501']) {
    for (const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ') {
      assert.equal(validFiscalCode(prefix + letter), letter === 'Q');
      assert.equal(validFiscalCode(prefix + letter.toLowerCase()), letter === 'Q');
    }
  }
  for (const value of ['', 'RSSMRA85Z01H501Q', 'RSSMRA85M00H501Q', 'RSSMRA85M01H501Qx']) assert.equal(validFiscalCode(value), false);
});
test('VAT checksum preserves alternating doubling, IT prefix and placeholder rejection', () => {
  for (const prefix of ['', 'IT', 'it', 'It']) {
    for (const digit of '0123456789') assert.equal(validItalianVat(prefix + '1234567890' + digit), digit === '3');
  }
  for (const value of ['', '00000000000', 'IT00000000000', '1234567890', '12345678903x']) assert.equal(validItalianVat(value), false);
});
test('IBAN check pair and letter expansion preserve modulo97 across case and ASCII spacing', () => {
  for (const digits of Array.from({ length: 100 }, (_, n) => String(n).padStart(2, '0'))) {
    const compact = `IT${digits}X0542811101000000123456`;
    for (const value of [compact, compact.toLowerCase(), compact.slice(0, 2) + ' ' + [...compact.slice(2)].join(' ')]) assert.equal(validItalianIban(value), digits === '60', value);
  }
  for (const value of ['', 'IT60K0542811101000000123456', 'IT60\tX0542811101000000123456', 'DE89370400440532013000']) assert.equal(validItalianIban(value), false);
});
