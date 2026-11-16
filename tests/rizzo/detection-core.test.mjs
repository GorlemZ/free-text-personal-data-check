import test from "node:test";
import assert from "node:assert/strict";
import { interpretModelOutput } from "../../poc-rizzo/dist/model/modelInterpretation.js";

import { detectCategories } from "../../poc-rizzo/dist/services/analysisService.js";

test("injected supplementary producer cannot recover a model-covered category", async () => {
  assert.deepEqual(
    [
      ...(await detectCategories(
        "synthetic",
        async () => new Set(),
        () => new Set(["EMAIL_ADDRESS", "IT_IDENTITY_CARD"]),
      )),
    ],
    ["IT_IDENTITY_CARD"],
  );
});

import { createDetector } from "./support/detector.mjs";

test("static sources never fill model omissions, but add Italian document categories", async () => {
  const detect = await createDetector({
    modelFactory: async () => async () => new Set(),
  });
  assert.deepEqual(
    [
      ...(await detect(
        "synthetic@example.test; 3331234567; RSSMRA85M01H501Q; partita iva 12345678903; IT60X0542811101000000123456; carta 4111111111111111",
      )),
    ],
    [],
  );
  assert.deepEqual(
    [...(await detect("carta di identità CA12345AA; patente AB1234567C"))],
    ["IT_IDENTITY_CARD", "IT_DRIVER_LICENSE"],
  );
  assert.deepEqual(
    [
      ...interpretModelOutput([
        { entity_group: "ID_DOC", score: 0.99 },
        { entity_group: "DOCID", score: 0.99 },
      ]),
    ],
    [],
  );
});

test("all covered labels keep inclusive threshold without checksum or shape veto", () => {
  const labels = [
    "FULLNAME",
    "EMAIL",
    "TELEPHONENUM",
    "CF",
    "PIVA",
    "IBAN",
    "CREDITCARDNUMBER",
  ];
  const categories = [
    "PERSON",
    "EMAIL_ADDRESS",
    "PHONE_NUMBER",
    "IT_FISCAL_CODE",
    "IT_VAT_CODE",
    "IBAN_CODE",
    "CREDIT_CARD",
  ];
  for (const score of [0, 0.499999, 0.5, 1]) {
    const output = Object.freeze(
      labels.map((entity_group) =>
        Object.freeze({
          entity_group,
          score,
          word: "invalid checksum and shape",
        }),
      ),
    );
    assert.deepEqual(
      [...interpretModelOutput(output)],
      score >= 0.5 ? categories : [],
    );
  }
});

test("native phone is model-owned; missing/empty words and invalid offsets cannot veto classification", () => {
  for (const metadata of [
    {},
    { word: "" },
    { word: "not a phone", start: -1, end: 999 },
  ]) {
    assert.deepEqual(
      [
        ...interpretModelOutput([
          { entity_group: "TELEPHONENUM", score: 0.5, ...metadata },
        ]),
      ],
      ["PHONE_NUMBER"],
    );
  }
});
