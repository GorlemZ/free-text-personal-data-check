import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createInference, semanticCategories } from './support/model.mjs';

const require = createRequire(new URL('../../poc-rizzo/package.json', import.meta.url));
// Match production's ESM build; require() has a separate global env singleton.
const { Tensor, PreTrainedTokenizer, AutoTokenizer, env } = await import(
  new URL('transformers.node.mjs', pathToFileURL(require.resolve('@huggingface/transformers')))
);
const entity = (entity_group = 'FULLNAME', score = .9, word = 'Ada Rossi') => ({ entity_group, score, word });
const tokenizer = () => ({ input_ids: { data: [1n, 2n] } });
const inferOutput = output => createInference({ tokenizer, pipeline: async () => output, maxTokens: 2 });

// Tiny, synthetic files exercise the real tokenizer and startup integrity without
// touching or loading the original model. Each isolated module owns one startup.
async function fixture(t) {
  const path = await mkdtemp(join(tmpdir(), 'rizzo-pipeline-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const files = {
    'config.json': JSON.stringify({ max_position_embeddings: 3, id2label: { 0: 'O', 1: 'B-FULLNAME', 2: 'I-FULLNAME' } }),
    'tokenizer.json': JSON.stringify({
      version: '1.0', truncation: null, padding: null, added_tokens: [], normalizer: null,
      pre_tokenizer: { type: 'Whitespace' }, post_processor: null, decoder: null,
      model: { type: 'WordLevel', vocab: { '[UNK]': 0, Ada: 1, Rossi: 2, extra: 3 }, unk_token: '[UNK]' },
    }),
    'model.onnx': 'synthetic integrity fixture, never an ONNX session',
  };
  await Promise.all(Object.entries(files).map(([name, content]) => writeFile(join(path, name), content)));
  const manifest = { files: Object.fromEntries(Object.entries(files).map(([name, content]) => [name, createHash('sha256').update(content).digest('hex')])) };
  await writeFile(join(path, 'manifest.json'), JSON.stringify(manifest));
  const { createModel } = await import(`./support/model.mjs?fixture=${encodeURIComponent(path)}`);
  return { createModel, path, directory: pathToFileURL(`${path}/`), manifestPath: pathToFileURL(join(path, 'manifest.json')) };
}

function fakeModel(config, onInput = () => {}) {
  return Object.assign(async inputs => {
    onInput(inputs);
    const ids = Array.from(inputs.input_ids.data, Number);
    const data = Float32Array.from(ids.flatMap(id => [0, id === 1 ? 10 : 0, id === 1 ? 0 : 10]));
    return { logits: new Tensor('float32', data, [1, ids.length, 3]) };
  }, { config });
}

test('public pipeline receives unchanged text with standard simple aggregation', async () => {
  const calls = [];
  const t = (text, options) => {
    calls.push({ text, options });
    return tokenizer();
  };
  const pipeline = async (text, options) => {
    calls.push({ text, options });
    return [entity()];
  };
  const infer = createInference({ tokenizer: t, pipeline, maxTokens: 2 });
  assert.deepEqual([...await infer('Ada Rossi')], ['PERSON']);
  assert.deepEqual(calls, [
    { text: 'Ada Rossi', options: { truncation: false, padding: false } },
    { text: 'Ada Rossi', options: { aggregation_strategy: 'simple' } },
  ]);
});

test('full preflight rejects limit plus one before the pipeline, accepts the exact limit', async () => {
  let calls = 0;
  const seen = [];
  const t = (text, options) => {
    seen.push(options);
    return { input_ids: { data: Array.from({ length: Number(text) }, () => 1n) } };
  };
  const infer = createInference({ tokenizer: t, pipeline: async () => { calls++; return []; }, maxTokens: 8192 });
  await assert.rejects(() => infer('8193'), /TOKEN_LIMIT/);
  assert.equal(calls, 0);
  assert.deepEqual([...await infer('8192')], []);
  assert.equal(calls, 1);
  assert.deepEqual(seen, Array.from({ length: 2 }, () => ({ truncation: false, padding: false })));
});

test('tokenizer and pipeline errors propagate unchanged without partial categories', async () => {
  const failure = new Error('synthetic inference failure');
  let ran = false;
  const preflightFailure = createInference({ tokenizer: () => { throw failure; }, pipeline: async () => { ran = true; }, maxTokens: 2 });
  await assert.rejects(() => preflightFailure('Ada'), error => error === failure);
  assert.equal(ran, false);
  const pipelineFailure = createInference({ tokenizer, pipeline: async () => { throw failure; }, maxTokens: 2 });
  await assert.rejects(() => pipelineFailure('Ada'), error => error === failure);
});

test('public entity validation rejects bad containers, labels, words and scores even below threshold', async () => {
  for (const output of [undefined, null, {}, 'invalid', [null], [[]], [entity('NEW_NATIVE_LABEL', .1)],
    [entity('B-FULLNAME')], [entity('FULLNAME', .1, 42)], [entity('CITY', NaN)],
    [entity('CITY', Infinity)], [entity('CITY', -Infinity)], [entity('CITY', -.1)],
    [entity('CITY', 1.1)], [entity('CITY', '0.9')], [entity(), entity('NEW_NATIVE_LABEL', .1)]]) {
    await assert.rejects(() => inferOutput(output)('synthetic'), /INVALID_MODEL_OUTPUT/);
  }
});

test('mapping retains all six categories and the unchanged inclusive threshold', async () => {
  const output = ['FULLNAME', 'EMAIL', 'CF', 'PIVA', 'IBAN', 'CREDITCARDNUMBER'].map(label => entity(label, .5));
  assert.deepEqual([...await inferOutput(output)('synthetic')].sort(),
    ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD'].sort());
  assert.deepEqual([...await inferOutput([entity('FULLNAME', .499999), entity('EMAIL', 1, '')])('synthetic')], []);
  assert.deepEqual([...await inferOutput([entity('FULLNAME', 1), entity('FULLNAME', 0)])('synthetic')], ['PERSON']);
});

test('model phone fragments and generic document labels cannot bypass full-text rules', async () => {
  for (const word of ['3331234567', '+1 3331234567', '+39 3331234567']) {
    assert.deepEqual([...await inferOutput([entity('TELEPHONENUM', .99, word)])('telefono +1 3331234567')], []);
  }
  assert.deepEqual([...await inferOutput([entity('ID_DOC'), entity('CITY'), entity('CF', .9, 'RSSMRA80A01H501X')])('synthetic')], ['IT_FISCAL_CODE']);
});

test('semantic adapter preserves its existing injection contract and validates native extras', () => {
  assert.deepEqual([...semanticCategories([{ label: 'CITY', text: 'synthetic city', score: .99 }])], []);
  assert.deepEqual([...semanticCategories([{ label: 'FULLNAME', text: 'synthetic person', score: .5 }])], ['PERSON']);
  for (const output of [null, {}, [null], [{}], [{ label: 'NEW_NATIVE_LABEL', text: 'x', score: .1 }], [{ label: 'CITY', text: 'x', score: NaN }]]) {
    assert.throws(() => semanticCategories(output), /INVALID_MODEL_OUTPUT/);
  }
});

test('startup composes the public pipeline with the exact local fp32 loader and reuses in-flight initialization', async t => {
  const f = await fixture(t);
  const { readFile } = await import('node:fs/promises');
  const config = JSON.parse(await readFile(join(f.path, 'config.json'), 'utf8'));
  let loads = 0;
  const seen = [];
  const loadModel = async (path, options) => {
    loads++;
    assert.equal(path, f.path + '/');
    assert.deepEqual(options, { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true });
    assert.equal(env.allowRemoteModels, false);
    await new Promise(resolve => setImmediate(resolve));
    return fakeModel(config, inputs => seen.push(Array.from(inputs.input_ids.data, Number)));
  };
  const [a, b] = await Promise.all([f.createModel({ ...f, loadModel }), f.createModel({ ...f, loadModel })]);
  assert.equal(a, b);
  assert.equal(loads, 1);
  assert.deepEqual([...await a('Ada Rossi')], ['PERSON']);
  assert.deepEqual([...await b('Ada')], ['PERSON']);
  assert.deepEqual(seen, [[1, 2], [1]]);
  assert.deepEqual([...await a('Ada Rossi extra')], ['PERSON']);
  assert.deepEqual(seen[2], [1, 2, 3]);
  await assert.rejects(() => a('Ada Rossi extra Ada'), /TOKEN_LIMIT/);
  assert.equal(seen.length, 3);
  assert.equal(await f.createModel({ ...f, loadModel }), a);
  assert.equal(loads, 1);
  const original = new PreTrainedTokenizer(JSON.parse(await readFile(join(f.path, 'tokenizer.json'), 'utf8')), { model_max_length: 3 });
  assert.deepEqual(Array.from(original('Ada Rossi', { truncation: false, padding: false }).input_ids.data, Number), seen[0]);
});

test('factory tokenizer loading cannot use these unchanged artifacts without tokenizer_config.json', async t => {
  const f = await fixture(t);
  // The pinned loader fails while reading tokenizer_class from the absent config.
  await assert.rejects(() => AutoTokenizer.from_pretrained(f.path, { local_files_only: true }), /tokenizer_class/);
});

test('startup verifies every artifact hash before loading a model', async t => {
  for (const name of ['config.json', 'tokenizer.json', 'model.onnx']) {
    const f = await fixture(t);
    await writeFile(join(f.path, name), 'tampered synthetic artifact');
    let loads = 0;
    await assert.rejects(() => f.createModel({ ...f, loadModel: async () => { loads++; } }), /MODEL_INTEGRITY_FAILURE/);
    assert.equal(loads, 0);
  }
});

test('missing startup artifacts propagate their filesystem error before model loading', async t => {
  const f = await fixture(t);
  await rm(join(f.path, 'model.onnx'));
  let loads = 0;
  await assert.rejects(() => f.createModel({ ...f, loadModel: async () => { loads++; } }), { code: 'ENOENT' });
  assert.equal(loads, 0);
});

test('startup loader failure propagates identically to concurrent callers', async t => {
  const f = await fixture(t);
  const failure = new Error('synthetic model load failure');
  let loads = 0;
  const loadModel = async () => { loads++; throw failure; };
  const results = await Promise.allSettled([f.createModel({ ...f, loadModel }), f.createModel({ ...f, loadModel })]);
  assert.equal(loads, 1);
  for (const result of results) {
    assert.equal(result.status, 'rejected');
    assert.equal(result.reason, failure);
  }
});
