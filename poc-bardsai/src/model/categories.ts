import type { Category } from "./contracts.js";

function catalog<const Values extends readonly string[]>(
  ...values: Values
): ReadonlySet<Values[number]> {
  return new Set(values);
}

// Single source for the closed application Category union and runtime catalog.
export const CATEGORIES = catalog(
  "PERSON",
  "EMAIL_ADDRESS",
  "IT_FISCAL_CODE",
  "IT_VAT_CODE",
  "IBAN_CODE",
  "CREDIT_CARD",
  "PHONE_NUMBER",
  "IT_IDENTITY_CARD",
  "IT_DRIVER_LICENSE",
);

export function isCategory(value: unknown): value is Category {
  return (
    typeof value === "string" &&
    [...CATEGORIES].some((category) => category === value)
  );
}

// Coverage is fixed for the engine, never inferred from a particular output.
export const CATEGORY_SOURCES: Readonly<Record<Category, "model" | "rule">> =
  Object.freeze({
    PERSON: "model",
    EMAIL_ADDRESS: "model",
    CREDIT_CARD: "model",
    PHONE_NUMBER: "model",
    IT_FISCAL_CODE: "rule",
    IT_VAT_CODE: "rule",
    IBAN_CODE: "rule",
    IT_IDENTITY_CARD: "rule",
    IT_DRIVER_LICENSE: "rule",
  });

// Compatibility exports keep the public PoC test surface stable while the
// implementation remains owned by the model adapter boundary.
export { categoriesOf, LABEL_MAP } from "../bardsai/interpretation.js";
