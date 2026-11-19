import { test } from "node:test";
import assert from "node:assert/strict";
import {
  BardsAiDecoder,
  tokenOffsets,
} from "../../poc-bardsai/dist/bardsai/decoder.js";
import { categoriesOf } from "../../poc-bardsai/dist/bardsai/interpretation.js";

function fixture({ text, tokens, labels, winningLabel, calls = [] }) {
  const ids = tokens.map((_, index) => index + 10);
  const vocab = new Map(tokens.map((token, index) => [token, ids[index]]));
  vocab.set("<bos>", 1);
  vocab.set("<eos>", 2);
  const tokenizer = {
    encode(value, options) {
      assert.equal(value, text);
      assert.deepEqual(options, { add_special_tokens: false });
      return ids;
    },
    get_vocab: () => vocab,
  };
  const model = Object.assign(
    async ({ input_ids }) => {
      calls.push(input_ids.dims[1]);
      const rows = input_ids.dims[1];
      const data = new Float32Array(rows * labels.length).fill(-20);
      const winner = labels.indexOf(winningLabel);
      for (let row = 1; row < rows - 1; row++)
        data[row * labels.length + winner] = 20;
      return { logits: { data } };
    },
    {
      config: {
        id2label: Object.fromEntries(
          labels.map((label, index) => [index, label]),
        ),
      },
    },
  );
  return new BardsAiDecoder({ tokenizer, model });
}

test("tokenOffsets reconstructs Metaspace/BPE and emoji byte fallback in UTF-16", () => {
  assert.deepEqual(
    tokenOffsets("Ciao 🙂 Ada", [
      "▁Ciao",
      "▁",
      "<0xF0>",
      "<0x9F>",
      "<0x99>",
      "<0x82>",
      "▁Ada",
    ]),
    [
      [0, 4],
      [4, 5],
      [5, 7],
      [5, 7],
      [5, 7],
      [5, 7],
      [7, 11],
    ],
  );
});

test("decoder derives and uses a dynamic 71-label id2label catalog", async () => {
  const types = Array.from({ length: 35 }, (_, index) =>
    index === 0 ? "PERSON_NAME" : `TYPE_${index}`,
  );
  const labels = ["O", ...types.flatMap((type) => [`B-${type}`, `I-${type}`])];
  const decoder = fixture({
    text: "Ada",
    tokens: ["Ada"],
    labels,
    winningLabel: "B-PERSON_NAME",
  });
  assert.equal(labels.length, 71);
  assert.deepEqual(await decoder.predict("Ada"), [
    { start: 0, end: 3, label: "PERSON_NAME", text: "Ada" },
  ]);
});

test("decoder uses 510-token bodies with 128-token overlap", async () => {
  const text = "a".repeat(900);
  const calls = [];
  const decoder = fixture({
    text,
    tokens: Array.from({ length: 900 }, () => "a"),
    labels: ["O", "B-PERSON_NAME", "I-PERSON_NAME"],
    winningLabel: "O",
    calls,
  });
  await decoder.predict(text);
  assert.deepEqual(calls, [512, 512, 138]);
});

test("email regex overrides overlapping model spans and empty text avoids inference", async () => {
  const text = "ada@example.com";
  const calls = [];
  const decoder = fixture({
    text,
    tokens: [text],
    labels: ["O", "B-PERSON_NAME", "I-PERSON_NAME"],
    winningLabel: "B-PERSON_NAME",
    calls,
  });
  assert.deepEqual(await decoder.predict(text), [
    { start: 0, end: text.length, label: "EMAIL_ADDRESS", text },
  ]);
  assert.deepEqual(await decoder.predict("  \n"), []);
  assert.equal(calls.length, 1);
});

test("format validation rejects phone and broad identifiers without enough digits", async () => {
  for (const label of ["PHONE_NUMBER", "PERSON_IDENTIFIER", "PAYMENT_CARD"]) {
    const decoder = fixture({
      text: "abcdef",
      tokens: ["abcdef"],
      labels: ["O", `B-${label}`, `I-${label}`],
      winningLabel: `B-${label}`,
    });
    assert.deepEqual(await decoder.predict("abcdef"), []);
  }
});

test("decoder rejects malformed and non-finite model logits", async () => {
  const tokenizer = {
    encode: () => [10],
    get_vocab: () =>
      new Map([
        ["<bos>", 1],
        ["<eos>", 2],
        ["Ada", 10],
      ]),
  };
  const catalog = {
    0: "O",
    1: "B-PERSON_NAME",
    2: "I-PERSON_NAME",
  };
  for (const data of [
    new Float32Array(),
    new Float32Array(9).fill(Number.NaN),
    new Float32Array(8),
  ]) {
    const model = Object.assign(async () => ({ logits: { data } }), {
      config: { id2label: catalog },
    });
    const decoder = new BardsAiDecoder({ tokenizer, model });
    await assert.rejects(decoder.predict("Ada"), /Invalid model logits/);
  }
});

test("mapping is conservative and unknown labels fail closed", () => {
  assert.deepEqual(
    categoriesOf([
      { start: 0, end: 1, label: "PERSON_NAME" },
      { start: 1, end: 2, label: "EMAIL_ADDRESS" },
      { start: 2, end: 3, label: "PHONE_NUMBER" },
      { start: 3, end: 4, label: "PAYMENT_CARD" },
    ]),
    new Set(["PERSON", "EMAIL_ADDRESS", "PHONE_NUMBER", "CREDIT_CARD"]),
  );
  assert.deepEqual(
    categoriesOf([{ start: 0, end: 1, label: "PERSON_IDENTIFIER" }]),
    new Set(),
  );
  assert.throws(
    () => categoriesOf([{ start: 0, end: 1, label: "NATIVE_UNRECOGNIZED" }]),
    /Unknown model label/,
  );
  assert.throws(
    () => categoriesOf([{ start: 1, end: 1, label: "PERSON_NAME" }]),
    /Invalid model candidate/,
  );
});
