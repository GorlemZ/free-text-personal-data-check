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
  test(`${label}: installed pipeline without offsets reaches document mapping over HTTP`, async () => {
    const results = await pipelineResult(label, value);
    await withService(results, async send => {
      assert.deepEqual(await send(context + value), { status: 200, body: rejected(category) });
    });
  });

  test(`${label}: trims decoded edge whitespace only before exact original association`, async () => {
    const results = await pipelineResult(label, ` ${value}\t`);
    await withService(results, async send => {
      assert.deepEqual(await send(`🙂 ${context}${value}.`), { status: 200, body: rejected(category) });
    });
  });

  test(`${label}: preserves standalone, non-BMP prefix, threshold and full allowlist policy`, async () => {
    for (const score of [0.1, 0.349, 0.35, 0.9]) {
      await withService([{ entity_group: label, score, word: value }], async send => {
        for (const text of [value, ` \t${value}\n`, `🙂 ${context}(${value}).`, `${context}🙂${value}🙂`]) {
          assert.deepEqual(await send(text), { status: 200, body: score >= 0.35 ? rejected(category) : accepted });
          assert.deepEqual(await send(text, fullAllowlist), { status: 200, body: accepted });
        }
      });
    }
  });

  test(`${label}: repeated literal is ambiguous even when only one occurrence has Italian context`, async () => {
    for (const word of [value, ` ${value} `]) {
      await withService([{ entity_group: label, score: 0.9, word }], async send => {
        for (const text of [
          `${context}${value}; unrelated item ${value}`,
          `unrelated item ${value}; ${context}${value}`,
          `${context}${value}; ${context}${value}`,
          `${context}${value}; embedded_${value}`,
        ]) assert.deepEqual(await send(text), { status: 200, body: accepted }, text);
      });
    }
  });

  test(`${label}: exact association retains Unicode full-token boundaries`, async () => {
    await withService([{ entity_group: label, score: 0.9, word: ` ${value} ` }], async send => {
      for (const neighbor of ['x', '9', '_', 'é', '中', '١', '²', '\u0301', '𐐀', '𝟙']) {
        for (const text of [`${context}${neighbor}${value}`, `${context}${value}${neighbor}`]) {
          assert.deepEqual(await send(text), { status: 200, body: accepted }, text);
        }
      }
    });
  });

  test(`${label}: never normalizes, searches generic IDs or invents missing word association`, async () => {
    for (const word of [undefined, '', ' \t\n', 'unmatched', value.toLowerCase(),
      value.slice(0, 2) + ' ' + value.slice(2), `(${value})`, value.slice(1)]) {
      await withService([{ entity_group: label, score: 0.9, word }], async send => {
        assert.deepEqual(await send(context + value), { status: 200, body: accepted });
      });
    }
    await withService([{ entity_group: label, score: 0.9, word: value }], async send => {
      for (const text of ['unrelated item ' + value, `patentex ${value}`, `documentoz ${value}`,
        `${context}${'.'.repeat(51)}${value}`, context + value.toLowerCase(),
        context + value.slice(0, 2) + ' ' + value.slice(2)]) {
        assert.deepEqual(await send(text), { status: 200, body: accepted }, text);
      }
    });
    for (const word of ['123-45-6789', 'D1234567', 'CA123456AA']) {
      await withService([{ entity_group: label, score: 0.9, word }], async send => {
        assert.deepEqual(await send(context + word), { status: 200, body: accepted });
      });
    }
  });

  test(`${label}: provided offsets remain authoritative and never fall back to word`, async () => {
    const prefix = `🙂 ${context}`;
    const text = `${prefix}${value}; ${'.'.repeat(60)} unrelated ${value}`;
    for (const [start, expected] of [[prefix.length, rejected(category)], [text.lastIndexOf(value), accepted]]) {
      // Repeated word is resolvable with offsets. A conflicting word does not
      // override the existing authoritative original-span path.
      for (const word of [value, 'not the span', undefined]) {
        await withService([{ entity_group: label, score: 0.9, start, end: start + value.length, word }], async send => {
          assert.deepEqual(await send(text), { status: 200, body: expected });
        });
      }
    }
    await withService([{ entity_group: label, score: 0.9, start: 0, end: 2, word: value }], async send => {
      assert.deepEqual(await send(prefix + value), { status: 200, body: accepted });
    });
  });
}

test('alternate Italian forms and canonical document aliases also work without offsets', async () => {
  for (const [entity_group, category, word] of [
    ['NATIONAL_ID', 'IT_IDENTITY_CARD', '1234567AB'],
    ['DRIVER_LICENSE', 'IT_DRIVER_LICENSE', 'U1B234567C'],
    ['IT_IDENTITY_CARD', 'IT_IDENTITY_CARD', 'CA12345AA'],
    ['IT_DRIVER_LICENSE', 'IT_DRIVER_LICENSE', 'AB1234567C'],
  ]) {
    await withService([{ entity_group, score: 0.9, word }], async send => {
      assert.deepEqual(await send(word), { status: 200, body: rejected(category) });
    });
  }
});

test('word association is document-only and cannot bypass structured model span/checksum gates', async () => {
  for (const [entity_group, text] of [
    ['IT_FISCAL_CODE', 'RSSMRA85M01H501Q'], ['IT_VAT_CODE', '12345678903'],
    ['IBAN_CODE', 'IT60X0542811101000000123456'], ['CREDIT_CARD', '4111 1111 1111 1111'],
    ['PHONE', '0212345678'], ['PHONE_NUMBER', '0212345678'],
  ]) {
    // Remove the independent rule producer only for this isolation test: its
    // valid finding would otherwise hide a regression in the model's span gate.
    const [analysis] = await analyzeFields([{ fieldId: 'a', text, allowedCategories: [] }], {
      prepare: text => ({ text }), infer: async () => [{ entity_group, score: 0.9, word: text }],
    }, () => [], categoriesOf, 0.35);
    assert.equal(analysis.candidates.length, 1);
    assert.deepEqual([...analysis.detected], [], entity_group);
    assert.deepEqual([...analysis.possible], [], entity_group);
    assert.deepEqual([...analysis.denied], [], entity_group);
  }
});

test('unknown labels and malformed scores/offsets still fail closed before allowlist policy', async () => {
  for (const candidate of [
    { entity_group: 'UNKNOWN_NATIVE', score: 0.01 },
    { entity_group: '__proto__', score: 0.9 },
    { score: '0.9' }, { score: NaN }, { score: -1 }, { score: 1.01 },
    { start: 0 }, { end: 9 }, { start: null, end: null },
    { start: -1, end: 9 }, { start: 0, end: 999 }, { start: 0.5, end: 9 },
    { start: 9, end: 0 },
  ]) {
    await withService([{ entity_group: 'NATIONAL_ID', score: 0.9, word: 'CA12345AA', ...candidate }], async send => {
      assert.deepEqual(await send('CA12345AA', fullAllowlist),
        { status: 503, body: { code: 'detector_unavailable' } });
    });
  }
});
