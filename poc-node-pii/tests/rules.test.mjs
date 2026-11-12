import test from 'node:test';
import assert from 'node:assert/strict';
import {recognize} from '../src/rules.ts';
test('Italian phones and document formats; foreign prefix and practice codes excluded',()=>{
 for(const text of ['chiamami al 3331234567','telefono +39 333 123 4567','telefono 0039 06 1234567']) assert.ok(recognize(text).has('PHONE_NUMBER'),text);
 for(const text of ['telefono +1 3331234567','telefono 0033 3331234567']) assert.equal(recognize(text).has('PHONE_NUMBER'),false);
 for(const text of ['CIE CA12345AA','carta di identità 1234567AB']) assert.ok(recognize(text).has('IT_IDENTITY_CARD'));
 for(const text of ['patente AB1234567C','patente U1B234567C']) assert.ok(recognize(text).has('IT_DRIVER_LICENSE'));
 assert.equal(recognize('codice pratica AB1234567C').has('IT_DRIVER_LICENSE'),false);
 assert.equal(recognize('ordine CA12345AA').has('IT_IDENTITY_CARD'),false);
 assert.equal(recognize('carta identità AB1234567').has('IT_IDENTITY_CARD'),false);
});
test('financial shapes retain bad checksums, international IBAN and require context for VAT',()=>{
 assert.ok(recognize('p.iva 12345678901').has('IT_VAT_CODE'));
 assert.equal(recognize('ordine 12345678901').has('IT_VAT_CODE'),false);
 for(const text of ['conto corrente IT00X0542811101000000123456','IBAN DE00 3704 0044 0532 0130 00','IBAN GB00 WEST 1234 5698 7654 32']) assert.ok(recognize(text).has('IBAN_CODE'));
 assert.ok(recognize('carta 4111 1111 1111 1112').has('CREDIT_CARD'));
 assert.equal(recognize('numero pratica 4111111111111112').has('CREDIT_CARD'),false);
});
test('CF including wrong checksum and omocodia; email; Unicode boundaries',()=>{
 assert.ok(recognize('cf RSSMRA80A01H501X').has('IT_FISCAL_CODE'));
 assert.ok(recognize('cf RSSMRAULALMHRLMA').has('IT_FISCAL_CODE'));
 assert.ok(recognize('Scrivi a ada.rossi@example.com.').has('EMAIL_ADDRESS'));
 assert.equal(recognize('éRSSMRA80A01H501X').has('IT_FISCAL_CODE'),false);
 assert.equal(recognize('RSSMRA80A01H501Xz').has('IT_FISCAL_CODE'),false);
});
