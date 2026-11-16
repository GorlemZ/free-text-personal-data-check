import { test } from "node:test";
import assert from "node:assert/strict";
import { analyzeFields } from "./analyze-fields.mjs";
import { recognizeItalianIdentifiers } from "../../poc-horizon/dist/recognizers/registry.js";
import {
  fiscalCodeCategories,
  validFiscalCode,
} from "../../poc-horizon/dist/recognizers/fiscal-code.js";
import {
  vatCategories,
  validItalianVat,
} from "../../poc-horizon/dist/recognizers/vat.js";
import {
  italianIbanCategories,
  validItalianIban,
} from "../../poc-horizon/dist/recognizers/italian-iban.js";

import {
  categoriesOf,
  CATEGORIES,
} from "../../poc-horizon/dist/model/categories.js";

const cf = "RSSMRA85M01H501Q";
const vat = "12345678903";
const iban = "IT60X0542811101000000123456";

const field = (text, allowedCategories = []) => ({
  fieldId: "description",
  text,
  allowedCategories,
});
const adapter = (results) => ({
  prepare: (text) => ({ text }),
  infer: async () => results,
});
const analyze = (
  text,
  results = [],
  allowed = [],
  recognize = recognizeItalianIdentifiers,
) =>
  analyzeFields(
    [field(text, allowed)],
    adapter(results),
    recognize,
    categoriesOf,
    0.35,
  );

for (const [category, value, candidates, valid, invalid] of [
  [
    "IT_FISCAL_CODE",
    cf,
    fiscalCodeCategories,
    validFiscalCode,
    cf.slice(0, -1) + "R",
  ],
  ["IT_VAT_CODE", vat, vatCategories, validItalianVat, vat.slice(0, -1) + "4"],
  [
    "IBAN_CODE",
    iban,
    italianIbanCategories,
    validItalianIban,
    "IT00" + iban.slice(4),
  ],
]) {
  test(`${category}: checksum diagnostics do not gate detection or field allowlists`, async () => {
    assert.equal(valid(value), true);
    assert.equal(valid(invalid), false);
    assert.deepEqual(candidates(value), new Set([category]));
    const [rejected] = await analyze(value);
    assert.deepEqual([...rejected.denied], [category]);
    const [accepted] = await analyze(value, [], [category]);
    assert.deepEqual([...accepted.denied], []);
    const [malformedChecksum] = await analyze(invalid);
    assert.equal(malformedChecksum.detected.has(category), true);
  });
}

test("catalog is exactly nine; known native extras are ignored before policy, unknown native fails", async () => {
  assert.deepEqual(
    [...CATEGORIES],
    [
      "PERSON",
      "EMAIL_ADDRESS",
      "IT_FISCAL_CODE",
      "IT_VAT_CODE",
      "IBAN_CODE",
      "CREDIT_CARD",
      "PHONE_NUMBER",
      "IT_IDENTITY_CARD",
      "IT_DRIVER_LICENSE",
    ],
  );
  const [analysis] = await analyze("plain text", [
    { entity_group: "TAX_ID", score: 0.99 },
    { entity_group: "BANK_ACCOUNT", score: 0.99 },
    { entity_group: "LICENSE_NUMBER", score: 0.99 },
  ]);
  assert.deepEqual([...analysis.denied], []);
  await assert.rejects(
    analyze("plain text", [{ entity_group: "NEW_NATIVE", score: 0.01 }]),
  );
});

test("failed rule cannot detect, and a valid overlapping native PERSON still denies", async () => {
  const invalid = "RSSMRA85Z01H501R";
  const [failed] = await analyze(invalid, [], [], fiscalCodeCategories);
  assert.deepEqual(fiscalCodeCategories(invalid), new Set());
  assert.deepEqual([...failed.detected], []);
  const [coEmitted] = await analyze(
    cf,
    [{ entity_group: "PERSON", score: 0.9, start: 0, end: cf.length }],
    ["IT_FISCAL_CODE"],
  );
  assert.deepEqual([...coEmitted.denied], ["PERSON"]);
});

test("supplementary rules reject embedded Unicode tokens", () => {
  for (const [value, recognizer] of [
    [cf, fiscalCodeCategories],
    [vat, vatCategories],
    [iban, italianIbanCategories],
  ]) {
    assert.deepEqual([...recognizer(`e\u0301${value}`)], []);
    assert.deepEqual([...recognizer(`${value}\u0301x`)], []);
  }

  assert.deepEqual(
    fiscalCodeCategories(`🙂${cf}`),
    new Set(["IT_FISCAL_CODE"]),
  );
});

test("internal analysis contains categories only, without provenance or raw words", async () => {
  const [analysis] = await analyze(
    cf,
    [
      {
        entity_group: "PERSON",
        score: 0.9,
        start: 0,
        end: cf.length,
        word: "DO_NOT_EXPOSE",
      },
    ],
    ["IT_FISCAL_CODE"],
    fiscalCodeCategories,
  );
  assert.deepEqual(Object.keys(analysis).sort(), [
    "denied",
    "detected",
    "fieldId",
  ]);
  assert.deepEqual([...analysis.denied], ["PERSON"]);
  assert.ok(!JSON.stringify(analysis).includes("DO_NOT_EXPOSE"));
});

test("model and rules both execute; malformed candidate errors do not return partial analysis", async () => {
  const events = [];
  const fields = [
    field(cf),
    { ...field("plain text"), fieldId: "contactName" },
  ];
  await assert.rejects(
    analyzeFields(
      fields,
      {
        prepare: (text) => {
          events.push("prepare");
          return { text };
        },
        infer: async ({ text }) => {
          events.push("infer");
          return text === "plain text"
            ? [{ entity_group: "UNKNOWN", score: 0.9 }]
            : [];
        },
      },
      (text) => {
        events.push("rules");
        return fiscalCodeCategories(text);
      },
      categoriesOf,
      0.35,
    ),
  );
  assert.deepEqual(events, ["prepare", "infer", "rules", "prepare", "infer"]);
});
