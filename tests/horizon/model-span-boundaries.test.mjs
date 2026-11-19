import test from "node:test";
import assert from "node:assert/strict";
import {
  categoriesOf,
  CATEGORY_SOURCES,
  CATEGORIES,
} from "../../poc-horizon/dist/model/categories.js";
import { analyzeFields } from "./analyze-fields.mjs";

for (const [label, category] of [
  ["PERSON", "PERSON"],
  ["EMAIL", "EMAIL_ADDRESS"],
  ["CREDIT_CARD", "CREDIT_CARD"],
  ["PHONE", "PHONE_NUMBER"],
]) {
  test(`${label}: threshold, deduplication and allowlist without span or semantic veto`, async () => {
    for (const score of [0, 0.349999, 0.35, 1]) {
      const [result] = await analyzeFields(
        [
          {
            fieldId: "a",
            text: "arbitrary invalid shape",
            allowedCategories: [category],
          },
        ],
        {
          prepare: (text) => ({ text }),
          infer: async () =>
            [0, 1].map(() => ({
              entity_group: label,
              score,
              start: null,
              end: -1,
            })),
        },
      );
      assert.deepEqual([...result.detected], score >= 0.35 ? [category] : []);
      assert.deepEqual([...result.denied], []);
      assert.deepEqual(Object.keys(result).sort(), [
        "denied",
        "detected",
        "fieldId",
      ]);
    }
  });
}
test("coverage matrix exhausts the catalog and native generic labels do not imply Italian categories", () => {
  assert.deepEqual(
    Object.keys(CATEGORY_SOURCES).sort(),
    [...CATEGORIES].sort(),
  );
  assert.deepEqual(
    [
      ...categoriesOf(
        ["TAX_ID", "BANK_ACCOUNT", "NATIONAL_ID", "DRIVER_LICENSE"].map(
          (entity_group) => ({ entity_group, score: 1 }),
        ),
      ),
    ],
    [],
  );
});
test("invalid labels/scores/optional word types fail even for extras or low confidence", () => {
  for (const result of [
    null,
    [],
    {},
    { entity_group: "UNKNOWN", score: 0 },
    ...[NaN, Infinity, -1, 1.1, "0.9"].map((score) => ({
      entity_group: "LOCATION",
      score,
    })),
    { entity_group: "LOCATION", score: 0, word: null },
  ])
    assert.throws(() => categoriesOf([result]));
});
