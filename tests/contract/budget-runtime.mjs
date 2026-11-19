import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { once } from "node:events";

export function budgetHttpTests() {
  test("real HTTP wiring counts special tokens, accepts exact budget and aborts late overflow without partial response", async (t) => {
    const require = createRequire(
      new URL("../../poc-horizon/package.json", import.meta.url),
    );
    const { PreTrainedTokenizer, TokenClassificationPipeline, Tensor } =
      await import(
        new URL(
          "transformers.node.mjs",
          pathToFileURL(require.resolve("@huggingface/transformers")),
        )
      );
    const tokenizerJSON = {
      version: "1.0",
      truncation: null,
      padding: null,
      added_tokens: [
        {
          id: 3,
          content: "[CLS]",
          single_word: false,
          lstrip: false,
          rstrip: false,
          normalized: false,
          special: true,
        },
        {
          id: 4,
          content: "[SEP]",
          single_word: false,
          lstrip: false,
          rstrip: false,
          normalized: false,
          special: true,
        },
      ],
      normalizer: null,
      pre_tokenizer: { type: "Whitespace" },
      post_processor: {
        type: "BertProcessing",
        sep: ["[SEP]", 4],
        cls: ["[CLS]", 3],
      },
      decoder: null,
      model: {
        type: "WordLevel",
        vocab: { "[UNK]": 0, Ada: 1, Rossi: 2, "[CLS]": 3, "[SEP]": 4 },
        unk_token: "[UNK]",
      },
    };
    const config = {
      max_position_embeddings: 4,
      id2label: { 0: "O", 1: "B-PERSON" },
    };
    const tokenizer = new PreTrainedTokenizer(tokenizerJSON, {
      model_max_length: 4,
    });
    assert.equal(
      tokenizer("Ada", { add_special_tokens: true }).input_ids.size,
      3,
      "SPECIAL_TOKEN_CONTROL",
    );
    assert.equal(
      tokenizer("Ada", { add_special_tokens: false }).input_ids.size,
      1,
      "NEGATIVE_SPECIAL_TOKEN_CONTROL",
    );
    const inputs = [],
      loads = [];
    const model = Object.assign(
      async (input) => {
        const ids = Array.from(input.input_ids.data, Number);
        inputs.push(ids);
        return {
          logits: new Tensor(
            "float32",
            Float32Array.from(ids.flatMap(() => [0, 10])),
            [1, ids.length, 2],
          ),
        };
      },
      { config },
    );
    const { transformersAdapterBuilder } =
      await import("../../poc-horizon/dist/adapters/transformersAdapter.js");
    const { analysisServiceBuilder } =
      await import("../../poc-horizon/dist/services/analysisService.js");
    const { createApp } = await import("../../poc-horizon/dist/app.js");
    const options = {
      createPipeline: async () => {
        loads.push("load");
        return new TokenClassificationPipeline({
          task: "token-classification",
          model,
          tokenizer,
        });
      },
    };
    const adapter = await transformersAdapterBuilder({
      ...options,
      tokenBudget: 3,
    });
    assert.equal(loads.length, 1);
    assert.equal(inputs.length, 0, "startup is not inference");
    const analysisService = analysisServiceBuilder({
      adapter,
      recognize: () => new Set(),
    });
    const server = createServer(
      createApp({ analysisService, ready: () => true, concurrency: 1 }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      server.closeAllConnections();
      server.close();
    });
    const post = (texts) =>
      fetch(`http://127.0.0.1:${server.address().port}/v1/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fields: texts.map((text, i) => ({ fieldId: String(i), text })),
        }),
      });
    const exact = await post(["Ada"]);
    assert.equal(exact.status, 200);
    assert.deepEqual(await exact.json(), {
      verdict: "rejected",
      findings: [{ fieldId: "0", category: "PERSON" }],
    });
    assert.deepEqual(inputs, [[3, 1, 4]]);
    const over = await post(["Ada Rossi"]);
    assert.equal(over.status, 503);
    assert.deepEqual(await over.json(), { code: "detector_unavailable" });
    assert.equal(inputs.length, 1);
    const late = await post(["Ada", "Ada Rossi", "Ada"]);
    assert.equal(late.status, 503);
    assert.deepEqual(await late.json(), { code: "detector_unavailable" });
    assert.equal(
      inputs.length,
      2,
      "only first field ran; no later work or partial success",
    );
    assert.equal((await post(["Ada"])).status, 200);
    assert.equal(inputs.length, 3);
    assert.equal(loads.length, 1);
    // Config must not exceed the native tokenizer/model ceiling.
    await assert.rejects(
      transformersAdapterBuilder({ ...options, tokenBudget: 5 }),
      /TOKEN_BUDGET/,
    );
  });
}
