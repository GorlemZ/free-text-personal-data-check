import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHandler } from "./create-test-app.mjs";
import { bardsAiAdapterBuilder } from "../../poc-bardsai/dist/adapters/bardsAiAdapter.js";

async function serve(
  t,
  infer,
  recognize = () => new Set(),
  prepare = (text) => ({ text }),
) {
  const server = createServer(
    createHandler({
      ready: () => true,
      prepare,
      infer,
      recognize,
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test("real HTTP fixture maps decoder entities and minimizes the public response", async (t) => {
  const secretText = "Ada riservata";
  const url = await serve(t, async () => [
    {
      label: "PERSON_NAME",
      start: 0,
      end: 3,
      text: secretText,
      probability: 0.999,
    },
  ]);
  const response = await fetch(url + "/v1/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: [
        { fieldId: "description", text: secretText, allowedCategories: [] },
      ],
    }),
  });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    verdict: "rejected",
    findings: [{ fieldId: "description", category: "PERSON" }],
  });
});

test("Italian recognizers remain separate from broad native identifiers", async (t) => {
  const url = await serve(
    t,
    async () => [],
    () => new Set(["IT_FISCAL_CODE", "IT_VAT_CODE", "IBAN_CODE"]),
  );
  const response = await fetch(url + "/v1/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: [
        { fieldId: "description", text: "synthetic", allowedCategories: [] },
      ],
    }),
  });
  assert.deepEqual(await response.json(), {
    verdict: "rejected",
    findings: ["IBAN_CODE", "IT_FISCAL_CODE", "IT_VAT_CODE"].map(
      (category) => ({ fieldId: "description", category }),
    ),
  });
});

test("malformed raw logits fail closed at the HTTP boundary", async (t) => {
  const tokenizer = {
    encode: () => [10],
    get_vocab: () =>
      new Map([
        ["<bos>", 1],
        ["<eos>", 2],
        ["Ada", 10],
      ]),
  };
  const model = Object.assign(
    async () => ({ logits: { data: new Float32Array() } }),
    {
      config: {
        id2label: {
          0: "O",
          1: "B-PERSON_NAME",
          2: "I-PERSON_NAME",
        },
      },
    },
  );
  const adapter = await bardsAiAdapterBuilder({
    loadTokenizer: async () => tokenizer,
    loadModel: async () => model,
  });
  const url = await serve(t, adapter.infer, () => new Set(), adapter.prepare);
  const response = await fetch(url + "/v1/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      fields: [{ fieldId: "description", text: "Ada", allowedCategories: [] }],
    }),
  });
  assert.equal(response.status, 503);
  assert.deepEqual(await response.json(), { code: "detector_unavailable" });
});
