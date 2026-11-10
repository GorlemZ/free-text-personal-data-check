import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFields } from '../dist/analysis/analyze-fields.mjs';
import { recognizeItalianIdentifiers } from '../dist/recognizers/registry.mjs';
import { categoriesOf } from '../src/categories.mjs';

const card = '4111 1111 1111 1111'; // Synthetic Luhn fixture.
const phone = '0212345678'; // libphonenumber Italian example metadata; no assignment claim.
const fixtures = [
  ['IT_FISCAL_CODE', 'RSSMRA85M01H501Q'],
  ['IT_VAT_CODE', '12345678903'],
  ['IBAN_CODE', 'IT60X0542811101000000123456'],
  ['CREDIT_CARD', card],
  ['PHONE_NUMBER', phone],
];

async function modelAnalysis(category, text, start, end, score = 0.9, allowed = []) {
  const entity_group = category === 'PHONE_NUMBER' ? 'PHONE' : category;
  // Exercise the generic structured gate for rule-only categories without changing
  // the native label map. Card and phone exercise the real Horizon resolver.
  const resolve = ['CREDIT_CARD', 'PHONE_NUMBER'].includes(category)
    ? categoriesOf : () => new Set([category]);
  const [analysis] = await analyzeFields([
    { fieldId: 'description', text, allowedEntityTypes: allowed },
  ], {
    prepare: text => ({ text }),
    infer: async () => [{ entity_group, score, start, end }],
  }, () => [], resolve, 0.35);
  return analysis;
}

for (const [category, value] of fixtures) {
  test(`${category}: model rejects embedded tokens in original context`, async () => {
    for (const neighbor of ['x', '9', '_', 'é', '中', '١', '²', '\u0301', '𐐀', '𝟙']) {
      for (const [prefix, suffix] of [[neighbor, ''], ['', neighbor]]) {
        const text = `${prefix}${value}${suffix}`;
        const start = prefix.length;
        const end = start + value.length;
        assert.equal(recognizeItalianIdentifiers(text).some(candidate =>
          candidate.category === category && candidate.start === start && candidate.end === end), false);
        const result = await modelAnalysis(category, text, start, end);
        assert.deepEqual([...result.detected], [], `${category}: ${JSON.stringify(text)}`);
        assert.deepEqual([...result.possible], []);
        assert.deepEqual([...result.denied], []);
        assert.equal(result.candidates.length, 1); // Retain provenance, not a finding.
      }
    }
  });

  test(`${category}: full model spans retain punctuation, UTF-16, threshold and allowlist behavior`, async () => {
    for (const [prefix, suffix] of [['', ''], ['(', ')'], ['🙂 ', '.'], ['🙂', '🙂']]) {
      const text = `${prefix}${value}${suffix}`;
      // Phone punctuation parentheses belong to its conservative numeric envelope.
      const wrappedPhone = category === 'PHONE_NUMBER' && prefix === '(';
      const start = wrappedPhone ? 0 : prefix.length;
      const end = wrappedPhone ? text.length : start + value.length;
      assert.ok(recognizeItalianIdentifiers(text).some(candidate => candidate.category === category &&
        candidate.start === start && candidate.end === end && candidate.check === 'passed'));
      const result = await modelAnalysis(category, text, start, end);
      assert.deepEqual([...result.detected], [category]);
      assert.deepEqual([...result.possible], [category]);
      assert.deepEqual([...result.denied], [category]);
      const low = await modelAnalysis(category, text, start, end, 0.1);
      assert.deepEqual([...low.detected], []);
      assert.deepEqual([...low.possible], [category]);
      const allowed = await modelAnalysis(category, text, start, end, 0.9, [category]);
      assert.deepEqual([...allowed.denied], []);
    }
  });
}

test('model card spans cannot select valid fragments of grouped numeric sequences', async () => {
  for (const value of [card, card.replaceAll(' ', '-'), [...card.replaceAll(' ', '')].join(' ')]) {
    for (const [prefix, suffix] of [['1 ', ''], ['1-', ''], ['', ' 1234'], ['', '-1234'], ['+', '']]) {
      const text = `${prefix}${value}${suffix}`;
      const result = await modelAnalysis('CREDIT_CARD', text, prefix.length, prefix.length + value.length);
      assert.deepEqual([...result.detected], [], JSON.stringify(text));
      assert.deepEqual([...result.possible], []);
    }
  }
});

test('model phone spans cannot drop an adjacent country prefix', async () => {
  for (const prefix of ['+', '+39', '0039']) {
    const text = prefix + phone;
    const result = await modelAnalysis('PHONE_NUMBER', text, prefix.length, text.length);
    assert.deepEqual([...result.detected], []);
    assert.deepEqual([...result.possible], []);
  }
});
