import test from "node:test";
import assert from "node:assert/strict";
import { analysisServiceBuilder } from "../../poc-horizon/dist/services/analysisService.js";
import { recognizeItalianIdentifiers } from "../../poc-horizon/dist/recognizers/registry.js";

const adapter = {
  ready: () => true,
  prepare: (text) => ({ text }),
  infer: async () => [],
};
test("supplementary application boundary accepts category sets without candidate/offset metadata", async () => {
  const analysis = analysisServiceBuilder({
    adapter,
    recognize: () => new Set(["IT_IDENTITY_CARD"]),
  });
  const fields = Object.freeze([
    Object.freeze({
      fieldId: "a",
      text: "arbitrary",
      allowedCategories: Object.freeze([]),
    }),
  ]);
  assert.deepEqual(await analysis.analyze(fields), [
    {
      fieldId: "a",
      detected: new Set(["IT_IDENTITY_CARD"]),
      denied: new Set(["IT_IDENTITY_CARD"]),
    },
  ]);
});
test("real supplementary recognizers return only deduplicated categories after local checks", () => {
  assert.deepEqual(
    recognizeItalianIdentifiers(
      "RSSMRA85M01H501Q; RSSMRA85M01H501Q; 12345678903; IT60X0542811101000000123456; CIE CA12345AA; patente AB1234567C",
    ),
    new Set([
      "IT_FISCAL_CODE",
      "IT_VAT_CODE",
      "IBAN_CODE",
      "IT_IDENTITY_CARD",
      "IT_DRIVER_LICENSE",
    ]),
  );
});
