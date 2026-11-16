import test from "node:test";
import { budgetHttpTests } from "../contract/budget-runtime.mjs";
budgetHttpTests("rizzo");
import assert from "node:assert/strict";
import {
  transformersAdapterBuilder,
  rawInferenceBuilder,
} from "../../poc-rizzo/dist/adapters/transformersAdapter.js";
import { readHttpConfig } from "../../poc-rizzo/dist/config/config.js";
test("explicit startup rejects invalid budget before loading assets", async () => {
  const result = transformersAdapterBuilder({ tokenBudget: 0 });
  assert.ok(
    result instanceof Promise,
    "startup must be explicit asynchronous initialization",
  );
  await assert.rejects(result, /TOKEN_BUDGET/);
});
test("configuration and raw adapter validate positive safe integer budgets", () => {
  for (const value of [
    "",
    "0",
    "-1",
    "1.5",
    "NaN",
    "Infinity",
    "9007199254740992",
  ]) {
    assert.throws(
      () => readHttpConfig({ ANALYZER_CONCURRENCY: value }),
      /CONCURRENCY/,
    );
    assert.throws(
      () => readHttpConfig({ ANALYZER_TOKEN_BUDGET: value }),
      /TOKEN_BUDGET/,
    );
  }
  assert.equal(readHttpConfig({}).concurrency, 1);
  for (const maxTokens of [0, -1, 1.5, NaN, Infinity])
    assert.throws(
      () =>
        rawInferenceBuilder({
          maxTokens,
          tokenizer: () => {
            throw Error("must not run");
          },
          pipeline: async () => [],
        }),
      /TOKEN_BUDGET/,
    );
});
