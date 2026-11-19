import test from "node:test";
import assert from "node:assert/strict";
import { recognize } from "../../poc-rizzo/dist/recognizers/rules.js";
import {
  CATEGORY_SOURCES,
  CATEGORIES,
} from "../../poc-rizzo/dist/model/categories.js";

test("Italian documents retain contextual/standalone forms and reject practice codes", () => {
  for (const text of [
    "CIE CA12345AA",
    "carta di identità 1234567AB",
    "CA12345AA",
  ])
    assert.ok(recognize(text).has("IT_IDENTITY_CARD"));
  for (const text of ["patente AB1234567C", "patente U1B234567C", "AB1234567C"])
    assert.ok(recognize(text).has("IT_DRIVER_LICENSE"));
  for (const text of [
    "codice pratica AB1234567C",
    "ordine CA12345AA",
    "carta identità AB1234567",
    "documento 123-45-6789",
  ])
    assert.deepEqual([...recognize(text)], []);
});
test("document rule Unicode boundaries and context distance remain conservative", () => {
  for (const value of ["CA12345AA", "AB1234567C"]) {
    for (const neighbor of [
      "x",
      "9",
      "_",
      "é",
      "中",
      "١",
      "²",
      "\u0301",
      "𐐀",
      "𝟙",
    ]) {
      for (const text of [
        `documento patente ${neighbor}${value}`,
        `documento patente ${value}${neighbor}`,
      ])
        assert.deepEqual([...recognize(text)], []);
    }
    assert.deepEqual(
      [...recognize("documento patente " + ".".repeat(51) + value)],
      [],
    );
  }
});
test("source matrix covers every category and never fills model omissions", () => {
  assert.deepEqual(
    Object.keys(CATEGORY_SOURCES).sort(),
    [...CATEGORIES].sort(),
  );
  for (const text of [
    "ada@example.test",
    "RSSMRA85M01H501Q",
    "p.iva 12345678903",
    "IT60X0542811101000000123456",
    "carta 4111111111111111",
    "telefono 3331234567",
  ])
    assert.deepEqual([...recognize(text)], []);
});
