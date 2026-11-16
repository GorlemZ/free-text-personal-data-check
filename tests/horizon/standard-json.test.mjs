import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAnalyzeRequest } from '../../poc-horizon/dist/validation/analyzeRequest.js';

test('standard JSON last-value-wins validates only the resulting closed schema', () => {
  assert.deepEqual(validateAnalyzeRequest('{"fields":null,"fields":[{"fieldId":null,"fieldId":"a","text":"\\ud800","text":"ok"}]}'),
    [{ fieldId: 'a', text: 'ok', allowedCategories: [] }]);
  assert.throws(() => validateAnalyzeRequest('{"fields":[{"fieldId":"a","text":"ok","text":null}]}'));
});
test('resulting Unicode strings and repeated fieldIds remain invalid', () => {
  for (const fields of [[{ fieldId: 'a', text: '\ud800' }], [{ fieldId: '\udc00', text: '' }],
    [{ fieldId: 'a', text: '' }, { fieldId: 'a', text: '' }]]) {
    assert.throws(() => validateAnalyzeRequest(JSON.stringify({ fields })));
  }
  assert.equal(validateAnalyzeRequest('{"fields":[{"fieldId":"\\ud83d\\ude42","text":"\\ud83d\\ude42"}]}')[0].text, '🙂');
});
