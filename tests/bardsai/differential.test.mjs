import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { BardsAiDecoder } from "../../poc-bardsai/dist/bardsai/decoder.js";

const requireFromPackage = createRequire(
  new URL("../../poc-bardsai/package.json", import.meta.url),
);
const { Tensor } = requireFromPackage("@huggingface/transformers");

const UPSTREAM_SHA = "0a197d136b8fd968c1fd3b709572fe531ecdb4e4";
const SOURCE_SHA256 =
  "8e0aff02835410465b2bb3f0f8c941d01ca29ea95da2960cef9306681e07658f";
const sourceUrl = new URL(
  `./fixtures/upstream-pii-${UPSTREAM_SHA}.txt`,
  import.meta.url,
);

async function loadPinnedUpstream() {
  const source = await readFile(sourceUrl, "utf8");
  assert.equal(
    createHash("sha256").update(source).digest("hex"),
    SOURCE_SHA256,
  );
  const importLine =
    'import { AutoTokenizer, AutoModelForTokenClassification, Tensor, env } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.1";';
  assert.ok(source.includes(importLine));
  const executable = source.replace(
    importLine,
    "const { AutoTokenizer, AutoModelForTokenClassification, Tensor, env } = globalThis.__bardsUpstreamSdk;",
  );
  globalThis.__bardsUpstreamSdk = {
    AutoTokenizer: {
      from_pretrained: async () => globalThis.__bardsFixture.tokenizer,
    },
    AutoModelForTokenClassification: {
      from_pretrained: async () => globalThis.__bardsFixture.model,
    },
    Tensor,
    env: {},
  };
  return import(`data:text/javascript,${encodeURIComponent(executable)}`).then(
    (module) => module.PIIDetector,
  );
}

function runtime({ text, tokens, labels, tokenLabels }) {
  const ids = tokens.map((_, index) => index + 10);
  const vocabulary = new Map(tokens.map((token, index) => [token, ids[index]]));
  vocabulary.set("<bos>", 1);
  vocabulary.set("<eos>", 2);
  const tokenizer = {
    encode(value, options) {
      assert.equal(value, text);
      assert.deepEqual(options, { add_special_tokens: false });
      return ids;
    },
    get_vocab: () => vocabulary,
  };
  const id2label = Object.fromEntries(
    labels.map((label, index) => [index, label]),
  );
  const model = Object.assign(
    async ({ input_ids }) => {
      const input = Array.from(input_ids.data, Number);
      const data = new Float32Array(input.length * labels.length).fill(-20);
      for (let row = 0; row < input.length; row++) {
        const tokenIndex = ids.indexOf(input[row]);
        const label = tokenIndex < 0 ? "O" : (tokenLabels[tokenIndex] ?? "O");
        data[row * labels.length + labels.indexOf(label)] = 20;
      }
      return { logits: { data } };
    },
    { config: { id2label } },
  );
  return { tokenizer, model };
}

test("TypeScript decoder matches the pinned official JavaScript decoder", async (t) => {
  const UpstreamDetector = await loadPinnedUpstream();
  t.after(() => {
    delete globalThis.__bardsFixture;
    delete globalThis.__bardsUpstreamSdk;
  });
  const cases = [
    {
      text: "Ada Rossi, tel. 123456 e ada@example.com",
      tokens: [
        "▁Ada",
        "▁Rossi",
        ",",
        "▁tel.",
        "▁123456",
        "▁e",
        "▁ada@example.com",
      ],
      labels: [
        "O",
        "B-PERSON_NAME",
        "I-PERSON_NAME",
        "B-PHONE_NUMBER",
        "I-PHONE_NUMBER",
      ],
      tokenLabels: [
        "B-PERSON_NAME",
        "I-PERSON_NAME",
        "O",
        "O",
        "B-PHONE_NUMBER",
        "O",
        "B-PERSON_NAME",
      ],
    },
    {
      text: "www.example.com abc",
      tokens: ["www.example.com", "▁abc"],
      labels: ["O", "B-IDENTIFYING_LINK", "I-IDENTIFYING_LINK"],
      tokenLabels: ["B-IDENTIFYING_LINK", "B-IDENTIFYING_LINK"],
    },
    {
      text: "🙂 Ada",
      tokens: ["<0xF0>", "<0x9F>", "<0x99>", "<0x82>", "▁Ada"],
      labels: ["O", "B-PERSON_NAME", "I-PERSON_NAME"],
      tokenLabels: ["O", "O", "O", "O", "B-PERSON_NAME"],
    },
  ];
  for (const fixture of cases) {
    globalThis.__bardsFixture = runtime(fixture);
    const upstream = await UpstreamDetector.load("synthetic", { dtype: "q8" });
    const candidate = new BardsAiDecoder(globalThis.__bardsFixture);
    assert.deepEqual(
      await candidate.predict(fixture.text),
      await upstream.predict(fixture.text),
    );
  }
});
