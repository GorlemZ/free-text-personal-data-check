import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validItalianPhone, italianPhoneCandidates } from '../dist/recognizers/italian-phone.mjs';

import { analyzeFields } from '../dist/analysis/analyze-fields.mjs';
import { categoriesOf } from '../src/categories.mjs';

// UK fixture from python-phonenumbers README; US fixture from libphonenumber-js README.
// Metadata validity only: these tests do not assert assignment or reachability.
test('international metadata-valid phone envelopes and UTF-16 spans', () => {
  for (const value of ['+44 20 8366 1177', '0044 20 8366 1177', '+1 (213) 373-4253', '02 1234 5678']) {
    assert.equal(validItalianPhone(value), true, value);
    const text = `🙂Chiama: ${value}!`;
    const [candidate] = italianPhoneCandidates(text);
    assert.equal(candidate.start, text.indexOf(value));
    assert.equal(candidate.end, text.indexOf(value) + value.length);
    assert.equal(candidate.check, 'passed');
  }
});

test('malformed full envelopes cannot yield valid domestic or international suffixes', async () => {
  for (const text of ['+999 02 1234 5678', '00999 02 1234 5678', '+44 02 1234 5678',
    '+1 200 555 0101', '+44 20 8366 1177 000000', 'é+44 20 8366 1177',
    '+44 20 8366 1177́', '𝟙+44 20 8366 1177', '+1 (213 373-4253']) {
    assert.deepEqual(italianPhoneCandidates(text), [], text);
  }
  const text = '🙂+999 02 1234 5678';
  const start = text.indexOf('02');
  const [result] = await analyzeFields([{ fieldId: 'description', text, allowedEntityTypes: [] }], {
    prepare: text => ({ text }),
    infer: async () => [{ entity_group: 'PHONE', score: 0.99, start, end: text.length }],
  }, italianPhoneCandidates, categoriesOf, 0.35);
  assert.equal(result.detected.has('PHONE_NUMBER'), false);
});

