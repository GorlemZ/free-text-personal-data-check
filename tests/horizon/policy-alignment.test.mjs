import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFields } from './analyze-fields.mjs';
import { recognizeItalianIdentifiers } from '../../poc-horizon/dist/recognizers/registry.js';
import { fiscalCodeCandidates, validFiscalCode } from '../../poc-horizon/dist/recognizers/fiscal-code.js';
import { vatCandidates, validItalianVat } from '../../poc-horizon/dist/recognizers/vat.js';
import { italianIbanCandidates, validItalianIban } from '../../poc-horizon/dist/recognizers/italian-iban.js';
import { creditCardCandidates, validCreditCard } from '../../poc-horizon/dist/recognizers/credit-card.js';
import { italianPhoneCandidates, validItalianPhone } from '../../poc-horizon/dist/recognizers/italian-phone.js';
import { categoriesOf, CATEGORIES } from '../../poc-horizon/dist/model/categories.js';

const cf = 'RSSMRA85M01H501Q';
const vat = '12345678903';
const iban = 'IT60X0542811101000000123456';
const card = '4111 1111 1111 1111'; // Synthetic Luhn test number; not a payment credential.
const phone = '+390212345678'; // phonenumbers IT example metadata; no assignment claim.
const field = (text, allowedCategories = []) => ({ fieldId: 'description', text, allowedCategories });
const adapter = results => ({ prepare: text => ({ text }), infer: async () => results });
const analyze = (text, results = [], allowed = [], recognize = recognizeItalianIdentifiers) =>
  analyzeFields([field(text, allowed)], adapter(results), recognize, categoriesOf, 0.35);

for (const [category, value, candidates, valid, invalid] of [
  ['IT_FISCAL_CODE', cf, fiscalCodeCandidates, validFiscalCode, cf.slice(0, -1) + 'R'],
  ['IT_VAT_CODE', vat, vatCandidates, validItalianVat, vat.slice(0, -1) + '4'],
  ['IBAN_CODE', iban, italianIbanCandidates, validItalianIban, 'IT00' + iban.slice(4)],
  ['CREDIT_CARD', card, creditCardCandidates, validCreditCard, card.slice(0, -1) + '2'],
  ['PHONE_NUMBER', phone, italianPhoneCandidates, validItalianPhone, '+999333123456'],
]) {
  test(`${category}: valid standalone rule, invalid near miss, and field allowlist`, async () => {
    assert.equal(valid(value), true);
    assert.equal(valid(invalid), false);
    assert.equal(candidates(value)[0].check, 'passed');
    const [rejected] = await analyze(value);
    assert.deepEqual([...rejected.denied], [category]);
    const [accepted] = await analyze(value, [], [category]);
    assert.deepEqual([...accepted.denied], []);
    const [nearMiss] = await analyze(invalid);
    assert.equal(nearMiss.detected.has(category), false);
  });
}

test('catalog is exactly nine; known native extras are ignored before policy, unknown native fails', async () => {
  assert.deepEqual([...CATEGORIES], ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE',
    'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'PHONE_NUMBER',
    'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']);
  const [analysis] = await analyze('plain text', [
    { entity_group: 'TAX_ID', score: 0.99 },
    { entity_group: 'BANK_ACCOUNT', score: 0.99 },
    { entity_group: 'LICENSE_NUMBER', score: 0.99 },
  ]);
  assert.deepEqual([...analysis.denied], []);
  await assert.rejects(analyze('plain text', [{ entity_group: 'NEW_NATIVE', score: 0.01 }]));
});

test('model card and phone require valid original-text spans; unknown or bad spans fail closed', async () => {
  const [cardMatch] = await analyze(card, [{ entity_group: 'CREDIT_CARD', score: 0.9,
    start: 0, end: card.length }], [], () => []);
  assert.deepEqual([...cardMatch.denied], ['CREDIT_CARD']);
  const [cardNoSpan] = await analyze(card, [{ entity_group: 'CREDIT_CARD', score: 0.9 }], [], () => []);
  assert.deepEqual([...cardNoSpan.denied], []);
  const [badCard] = await analyze('4111 1111 1111 1112', [{ entity_group: 'CREDIT_CARD',
    score: 0.9, start: 0, end: card.length }], [], () => []);
  assert.deepEqual([...badCard.denied], []);
  const [foreign] = await analyze('+999333123456', [{ entity_group: 'PHONE',
    score: 0.9, start: 0, end: 13 }], [], () => []);
  assert.deepEqual([...foreign.denied], []);
  await assert.rejects(analyze(card, [{ entity_group: 'CREDIT_CARD', score: 0.9,
    start: 0, end: card.length + 1 }], [], () => []));
});

test('failed rule cannot detect, and a valid overlapping native PERSON still denies', async () => {
  const invalid = cf.slice(0, -1) + 'R';
  const [failed] = await analyze(invalid, [], [], fiscalCodeCandidates);
  assert.equal(failed.candidates[0].check, 'failed');
  assert.deepEqual([...failed.detected], []);
  const [coEmitted] = await analyze(cf, [{ entity_group: 'PERSON', score: 0.9,
    start: 0, end: cf.length }], ['IT_FISCAL_CODE']);
  assert.deepEqual([...coEmitted.denied], ['PERSON']);
});

test('standalone boundaries reject embedded Unicode tokens and card fragments', async () => {
  for (const [value, recognizer] of [[cf, fiscalCodeCandidates],
    [vat, vatCandidates], [iban, italianIbanCandidates],
    [card, creditCardCandidates], [phone, italianPhoneCandidates]]) {
    assert.deepEqual(recognizer(`e\u0301${value}`), []);
    assert.deepEqual(recognizer(`${value}\u0301x`), []);
  }
  const [tooLong] = await analyze(`${card} 1234`);
  assert.equal(tooLong.detected.has('CREDIT_CARD'), false);
  const spaced = [...card.replace(/ /g, '')].join(' ');
  assert.equal(creditCardCandidates(spaced)[0].check, 'passed');
  for (const prefix of ['1 ', '1-']) {
    const [candidate] = creditCardCandidates(`${prefix}${spaced}`);
    assert.equal(candidate?.start, 0);
    assert.equal(candidate?.check, 'failed');
  }
  assert.equal(fiscalCodeCandidates(`🙂${cf}`)[0].start, 2); // UTF-16 offsets
});

test('internal analysis retains rule/model origin and original offsets without raw words', async () => {
  const [analysis] = await analyze(cf, [{ entity_group: 'PERSON', score: 0.9,
    start: 0, end: cf.length, word: 'DO_NOT_EXPOSE' }], ['IT_FISCAL_CODE'], fiscalCodeCandidates);
  assert.deepEqual(analysis.candidates, [
    { source: 'rule', category: 'IT_FISCAL_CODE', start: 0, end: cf.length, check: 'passed' },
    { source: 'model', category: 'PERSON', start: 0, end: cf.length, score: 0.9 },
  ]);
  assert.deepEqual([...analysis.denied], ['PERSON']);
  assert.ok(!JSON.stringify(analysis).includes('DO_NOT_EXPOSE'));
});

test('model and rules both execute; malformed candidate errors do not return partial analysis', async () => {
  const events = [];
  const fields = [field(cf), { ...field('plain text'), fieldId: 'contactName' }];
  await assert.rejects(analyzeFields(fields, {
    prepare: text => { events.push('prepare'); return { text }; },
    infer: async ({ text }) => { events.push('infer');
      return text === 'plain text' ? [{ entity_group: 'UNKNOWN', score: 0.9 }] : []; },
  }, text => { events.push('rules'); return fiscalCodeCandidates(text); }, categoriesOf, 0.35));
  assert.deepEqual(events, ['prepare', 'prepare', 'rules', 'infer', 'rules', 'infer']);
});
