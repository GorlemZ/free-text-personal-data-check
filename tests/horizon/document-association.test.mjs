import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { TokenClassificationPipeline } from '../../poc-horizon/node_modules/@huggingface/transformers/src/pipelines/token-classification.js';
import { Tensor } from '../../poc-horizon/node_modules/@huggingface/transformers/src/utils/tensor.js';
import { createHandler } from './create-test-app.mjs';
import { categoriesOf } from '../../poc-horizon/dist/model/categories.js';
import { analyzeFields } from './analyze-fields.mjs';

const documents = [
  ['NATIONAL_ID', 'IT_IDENTITY_CARD', 'CA12345AA', 'carta di identità: '],
  ['DRIVER_LICENSE', 'IT_DRIVER_LICENSE', 'AB1234567C', 'patente: '],
];
const accepted = { verdict: 'accepted', findings: [] };
const fullAllowlist = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE',
  'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'];
const rejected = category => ({ verdict: 'rejected', findings: [{ fieldId: 'a', category }] });

async function withService(results, run) {
  const server = createServer(createHandler({ ready: async () => true,
    prepare: text => ({ text }), infer: async () => results }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/v1/analyze`;
  const send = async (text, allowedCategories = []) => {
    const response = await fetch(url, { method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields: [{ fieldId: 'a', text, allowedCategories }] }) });
    return { status: response.status, body: await response.json() };
  };
  try { await run(send); } finally { await new Promise(resolve => server.close(resolve)); }
}

// Run the installed pipeline's real softmax/BIO aggregation/decode path, not a
// hand-written result shape. Only tokenization and model logits are synthetic:
// no weights, network, ONNX session or model inference are used.
async function pipelineResult(label, word) {
  const pieces = [word.slice(0, 2), word.slice(2)];
  const tokenizer = () => ({ input_ids: new Tensor('int64', [0n, 1n], [1, 2]) });
  tokenizer.decode = ids => ids.map(id => pieces[Number(id)]).join('');
  const model = async () => ({ logits: new Tensor('float32',
    [0, 12, 0, 0, 0, 12], [1, 2, 3]) });
  model.config = { id2label: { 0: 'O', 1: `B-${label}`, 2: `I-${label}` } };
  const pipeline = new TokenClassificationPipeline({ task: 'token-classification', tokenizer, model });
  const results = await pipeline(word, { aggregation_strategy: 'simple' });
  assert.equal(results.length, 1);
  assert.deepEqual(Object.keys(results[0]).sort(), ['entity_group', 'score', 'word']);
  assert.equal(results[0].entity_group, label);
  assert.equal(results[0].word, word);
  assert.ok(results[0].score > 0.99 && results[0].score <= 1);
  return results;
}

test('provided malformed document words fail closed even with the full allowlist', async () => {
  for (const [entity_group, , word, context] of documents) {
    for (const malformed of [null, 17, [], {}, true]) {
      await withService([{ entity_group, score: 0.1, word: malformed }], async send => {
        assert.deepEqual(await send(context + word, fullAllowlist),
          { status: 503, body: { code: 'detector_unavailable' } });
      });
    }
  }
});

for (const [label, category, value, context] of documents) {
  test(`${label}: native generic label cannot classify nationality; supplementary rules do`, async () => {
    const results = await pipelineResult(label, value);
    assert.deepEqual([...categoriesOf(results, .35, context + value)], []);
    for (const output of [[], results, [{ entity_group: label, score: .1, word: 'unrelated', start: -1 }]]) {
      await withService(output, async send => {
        for (const text of [value, context + value, `${context}${value}; ${value}`]) {
          assert.deepEqual(await send(text), { status: 200, body: rejected(category) });
          assert.deepEqual(await send(text, [category]), { status: 200, body: accepted });
        }
        for (const neighbor of ['x', '9', '_', 'é', '中', '١', '²', '\u0301', '𐐀', '𝟙']) {
          for (const text of [context + neighbor + value, context + value + neighbor]) {
            assert.deepEqual(await send(text), { status: 200, body: accepted });
          }
        }
        for (const text of ['unrelated item ' + value, context + '.'.repeat(51) + value, context + '123-45-6789']) {
          assert.deepEqual(await send(text), { status: 200, body: accepted });
        }
      });
    }
  });
}
