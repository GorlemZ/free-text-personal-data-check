import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createInference, semanticCategories } from './support/model.mjs';
import { decodeBIO } from './fixtures/legacy-decoder.mjs';

const require = createRequire(new URL('../../poc-rizzo/package.json', import.meta.url));
const { TokenClassificationPipeline, Tensor } = await import(
  new URL('transformers.node.mjs', pathToFileURL(require.resolve('@huggingface/transformers')))
);

// Real pinned public pipeline, synthetic model/Tensors only. These tests prove
// standard postprocessing and the application boundary, NOT real-weight parity.
function example({ values, labels, ids = [1, 2], words = { 1: '', 2: 'Ada' }, specialIds = [1], maxTokens = ids.length, modelFailure }) {
  const classes = Object.keys(labels).length;
  const logits = { dims: [1, ids.length, classes], data: Float32Array.from(values) };
  const tokenizations = [];
  const tokenizer = Object.assign((text, options) => {
    tokenizations.push({ text, options });
    return { input_ids: new Tensor('int64', BigInt64Array.from(ids, BigInt), [1, ids.length]) };
  }, {
    all_special_ids: specialIds,
    decode: tokenIds => tokenIds.map(id => words[Number(id)]).filter(Boolean).join(' '),
  });
  let runs = 0;
  const model = Object.assign(async () => {
    runs++;
    if (modelFailure) throw modelFailure;
    return { logits: new Tensor('float32', logits.data, logits.dims) };
  }, { config: { id2label: labels } });
  const pipeline = new TokenClassificationPipeline({ task: 'token-classification', model, tokenizer });
  const infer = createInference({ tokenizer, pipeline, maxTokens });
  return { ids, logits, tokenizer, pipeline, infer, tokenizations, runs: () => runs };
}

function winning(indices, classes) {
  return indices.flatMap(index => Array.from({ length: classes }, (_, i) => i === index ? 10 : -10));
}

test('standard pipeline skips non-finite logits on a special token; legacy raw failure is not preserved', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME' };
  const f = example({ labels, values: [10, NaN, 0, 10] });
  assert.throws(() => decodeBIO(f.ids, f.logits, labels, f.tokenizer), /INVALID_MODEL_OUTPUT/);
  const output = await f.pipeline('Ada', { aggregation_strategy: 'simple' });
  assert.equal(output.length, 1);
  assert.equal(output[0].entity_group, 'FULLNAME');
  assert.deepEqual([...await f.infer('Ada')], ['PERSON']);
});

test('standard simple grouping crosses a filtered O and can lower the category below threshold', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME', 2: 'I-FULLNAME' };
  const f = example({ labels, ids: [11, 22, 33], specialIds: [], words: { 11: 'Ada', 22: 'e', 33: 'Rossi' },
    values: [0, .8, 0, 10, 0, 0, 0, 0, .1] });
  const baseline = semanticCategories(decodeBIO(f.ids, f.logits, labels, f.tokenizer));
  const output = await f.pipeline('Ada e Rossi', { aggregation_strategy: 'simple' });
  assert.deepEqual([...baseline], ['PERSON']);
  assert.equal(output.length, 1);
  assert.equal(output[0].entity_group, 'FULLNAME');
  assert.equal(output[0].word, 'Ada Rossi');
  assert.ok(output[0].score < .5);
  assert.deepEqual([...await f.infer('Ada e Rossi')], []);
});

test('standard pipeline skips a malformed winning label on a special token', async () => {
  const labels = { 0: 'O', 1: 'BAD_LABEL', 2: 'B-FULLNAME' };
  const f = example({ labels, values: [0, 10, 0, 0, 0, 10] });
  assert.throws(() => decodeBIO(f.ids, f.logits, labels, f.tokenizer), /INVALID_MODEL_LABEL/);
  assert.deepEqual([...await f.infer('Ada')], ['PERSON']);
});

test('standard BIO grouping preserves Unicode and the tail with the same preflight tokenizer', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME', 2: 'I-FULLNAME', 3: 'B-EMAIL' };
  const f = example({ labels, ids: [0, 11, 12, 13, 0], specialIds: [0], words: { 0: '', 11: 'Zoë', 12: 'D’Amico', 13: 'synthetic@example.test' },
    values: winning([0, 1, 2, 3, 0], 4) });
  const output = await f.pipeline('Zoë D’Amico synthetic@example.test', { aggregation_strategy: 'simple' });
  assert.deepEqual(output.map(item => [item.entity_group, item.word]), [['FULLNAME', 'Zoë D’Amico'], ['EMAIL', 'synthetic@example.test']]);
  assert.deepEqual([...await f.infer('Zoë D’Amico synthetic@example.test')], ['PERSON', 'EMAIL_ADDRESS']);
  assert.deepEqual(f.tokenizations.slice(-2), [
    { text: 'Zoë D’Amico synthetic@example.test', options: { truncation: false, padding: false } },
    { text: ['Zoë D’Amico synthetic@example.test'], options: { padding: true, truncation: true } },
  ]);
});

test('standard simple respects a new B group rather than a custom name aggregator', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME', 2: 'I-FULLNAME' };
  const f = example({ labels, ids: [11, 12, 13], specialIds: [], words: { 11: 'Ada', 12: 'Rossi', 13: 'Zoë' }, values: winning([1, 2, 1], 3) });
  const output = await f.pipeline('synthetic', { aggregation_strategy: 'simple' });
  assert.deepEqual(output.map(item => item.word), ['Ada Rossi', 'Zoë']);
  assert.deepEqual([...await f.infer('synthetic')], ['PERSON']);
});

test('non-finite score in an observed public entity is rejected without partial categories', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME', 2: 'B-EMAIL' };
  const f = example({ labels, ids: [11, 12], specialIds: [], words: { 11: 'Ada', 12: 'synthetic@example.test' }, values: [0, 10, 0, 0, NaN, 10] });
  const output = await f.pipeline('synthetic', { aggregation_strategy: 'simple' });
  assert.equal(output.length, 2);
  assert.ok(Number.isNaN(output[1].score));
  await assert.rejects(() => f.infer('synthetic'), /INVALID_MODEL_OUTPUT/);
});

test('non-finite logits filtered as O are not raw-validated by the application', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME' };
  const f = example({ labels, ids: [11], specialIds: [], words: { 11: 'synthetic' }, values: [10, NaN] });
  assert.deepEqual([...await f.infer('synthetic')], []);
});

test('unknown labels in public entities are rejected, unlike skipped special-token labels', async () => {
  const labels = { 0: 'O', 1: 'B-NEW_NATIVE_LABEL' };
  const f = example({ labels, ids: [11], specialIds: [], words: { 11: 'synthetic' }, values: [0, 10] });
  await assert.rejects(() => f.infer('synthetic'), /INVALID_MODEL_OUTPUT/);
});

test('real public pipeline score at exactly 0.5 meets the unchanged threshold', async () => {
  const labels = { 0: 'B-FULLNAME', 1: 'O' };
  const f = example({ labels, ids: [11], specialIds: [], words: { 11: 'Ada' }, values: [0, 0] });
  const output = await f.pipeline('Ada', { aggregation_strategy: 'simple' });
  assert.equal(output[0].score, .5);
  assert.deepEqual([...await f.infer('Ada')], ['PERSON']);
});

test('model errors propagate unchanged through the real public pipeline', async () => {
  const failure = new Error('synthetic model execution failure');
  const labels = { 0: 'O', 1: 'B-FULLNAME' };
  const f = example({ labels, values: winning([0, 1], 2), modelFailure: failure });
  await assert.rejects(() => f.infer('Ada'), error => error === failure);
  assert.equal(f.runs(), 1);
});

test('preflight prevents standard pipeline truncation from concealing an over-limit tail', async () => {
  const labels = { 0: 'O', 1: 'B-FULLNAME' };
  const f = example({ labels, values: winning([0, 1], 2), maxTokens: 1 });
  await assert.rejects(() => f.infer('Ada'), /TOKEN_LIMIT/);
  assert.equal(f.runs(), 0);
  assert.equal(f.tokenizations.length, 1);
  assert.deepEqual(f.tokenizations[0].options, { truncation: false, padding: false });
});
