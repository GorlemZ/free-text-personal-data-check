import test from "node:test";
import assert from "node:assert/strict";
import { analyzeFields } from "./analyze-fields.mjs";
import { categoriesOf } from "../../poc-horizon/dist/model/categories.js";

test("static sources: empty model never recovers covered phone/card; Italian documents are independent rules", async () => {
  const analyze = async (text, output = []) =>
    (
      await analyzeFields([{ fieldId: "a", text }], {
        prepare: (text) => ({ text }),
        infer: async () => output,
      })
    )[0];
  assert.deepEqual(
    [...(await analyze("4111 1111 1111 1111; 3331234567")).detected],
    [],
  );
  assert.deepEqual(
    [
      ...categoriesOf(
        [
          { entity_group: "NATIONAL_ID", score: 0.99, word: "CA12345AA" },
          { entity_group: "DRIVER_LICENSE", score: 0.99, word: "AB1234567C" },
        ],
        0.35,
        "CA12345AA",
      ),
    ],
    [],
  );
  assert.deepEqual(
    [
      ...(await analyze("carta di identità CA12345AA; patente AB1234567C"))
        .detected,
    ],
    ["IT_IDENTITY_CARD", "IT_DRIVER_LICENSE"],
  );
});

test("model and complete mapping precede rules, errors never permit rule-only success", async () => {
  const events = [];
  const run = (output) =>
    analyzeFields(
      [{ fieldId: "a", text: "synthetic" }],
      {
        prepare: (text) => ({ text }),
        infer: async () => {
          events.push("model");
          return output;
        },
      },
      () => {
        events.push("rules");
        return new Set();
      },
    );
  await run([
    {
      get entity_group() {
        events.push("mapping");
        return "PERSON";
      },
      score: 0.35,
    },
  ]);
  assert.deepEqual(events, ["model", "mapping", "rules"]);
  for (const output of [null, [{ entity_group: "UNKNOWN", score: 0.1 }]]) {
    events.length = 0;
    await assert.rejects(run(output));
    assert.deepEqual(events, ["model"]);
  }
});

test("model categories depend only on native label and score, never span/checksum/shape", () => {
  for (const metadata of [
    {},
    { start: -1, end: 999 },
    { start: null },
    { word: "" },
    { word: "not a card or phone" },
  ]) {
    const result = categoriesOf(
      ["CREDIT_CARD", "PHONE"].map((entity_group) => ({
        entity_group,
        score: 0.35,
        ...metadata,
      })),
    );
    assert.deepEqual(result, new Set(["CREDIT_CARD", "PHONE_NUMBER"]));
  }
});
