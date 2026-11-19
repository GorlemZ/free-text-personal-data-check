import { test } from "node:test";
import assert from "node:assert/strict";
import { bardsAiAdapterBuilder } from "../../poc-bardsai/dist/bardsai/model.js";

function tokenizer() {
  return {
    encode(text, options) {
      assert.deepEqual(options, { add_special_tokens: false });
      return Array.from({ length: Number(text) }, (_, index) => index + 10);
    },
    get_vocab() {
      return new Map([
        ["<bos>", 1],
        ["<eos>", 2],
      ]);
    },
  };
}

const model = Object.assign(
  async () => {
    throw new Error("inference must not run during preflight");
  },
  { config: { id2label: { 0: "O", 1: "B-PERSON_NAME", 2: "I-PERSON_NAME" } } },
);

test("adapter enforces the configured token budget before inference", async () => {
  const adapter = await bardsAiAdapterBuilder({
    loadTokenizer: async () => tokenizer(),
    loadModel: async () => model,
  });

  await assert.rejects(adapter.analyzeText("513"), {
    message: "TOKEN_BUDGET_EXCEEDED",
  });
  await assert.rejects(adapter.analyzeText("512"), {
    message: "inference must not run during preflight",
  });
});

test("adapter rejects invalid token budget overrides", async () => {
  for (const tokenBudget of [0, -1, 513, 1.5, Number.NaN]) {
    await assert.rejects(
      bardsAiAdapterBuilder({
        tokenBudget,
        loadTokenizer: async () => tokenizer(),
        loadModel: async () => model,
      }),
      TypeError,
    );
  }
});
