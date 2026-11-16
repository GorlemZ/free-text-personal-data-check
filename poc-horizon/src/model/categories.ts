import { isRecord } from "./contracts.js";
import type { Category, ModelPrediction } from "./contracts.js";

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

// All 29 known native Horizon labels; only business aliases enter the catalog.
export const LABEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  ACCOUNT_ID: "ACCOUNT_ID",
  AGE: "AGE",
  BANK_ACCOUNT: "BANK_ACCOUNT",
  COORDINATE: "COORDINATE",
  CREDIT_CARD: "CREDIT_CARD",
  CREDIT_CARD_CVV: "CREDIT_CARD_CVV",
  DATE: "DATE",
  DATE_OF_BIRTH: "DATE_OF_BIRTH",
  DEVICE_ID: "DEVICE_ID",
  DRIVER_LICENSE: "DRIVER_LICENSE",
  EMAIL: "EMAIL_ADDRESS",
  IP_ADDRESS: "IP_ADDRESS",
  LICENSE_NUMBER: "LICENSE_NUMBER",
  LOCATION: "LOCATION",
  MAC_ADDRESS: "MAC_ADDRESS",
  MEDICAL_ID: "MEDICAL_ID",
  NATIONAL_ID: "NATIONAL_ID",
  ORGANIZATION: "ORGANIZATION",
  PASSPORT: "PASSPORT",
  PASSWORD: "PASSWORD",
  PERSON: "PERSON",
  PHONE: "PHONE_NUMBER",
  POSTCODE: "POSTCODE",
  SECRET: "SECRET",
  STREET_ADDRESS: "STREET_ADDRESS",
  TAX_ID: "TAX_ID",
  URL: "URL",
  USERNAME: "USERNAME",
  VEHICLE_ID: "VEHICLE_ID",
});
export const SCORE_THRESHOLD = 0.35; // PoC threshold, not calibrated probability.

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

function validateModelPrediction(raw: unknown): ModelPrediction {
  if (!isRecord(raw)) throw new Error("Invalid model candidate");
  const { entity_group, score, word } = raw;
  if (
    typeof entity_group !== "string" ||
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    score < 0 ||
    score > 1 ||
    (word !== undefined && typeof word !== "string")
  )
    throw new Error("Invalid model candidate");
  return { entity_group, score };
}

function categoryOf(result: ModelPrediction): Category | undefined {
  const label = result.entity_group;
  if (!Object.hasOwn(LABEL_MAP, label) && !isCategory(label))
    throw new Error("Unknown model label");
  const category = Object.hasOwn(LABEL_MAP, label) ? LABEL_MAP[label] : label;
  return isCategory(category) && CATEGORY_SOURCES[category] === "model"
    ? category
    : undefined;
}
export function categoriesOf(
  results: unknown,
  threshold = SCORE_THRESHOLD,
): ReadonlySet<Category> {
  if (!Array.isArray(results)) throw new Error("Invalid model results");
  return new Set(
    (results as readonly unknown[]).flatMap((raw) => {
      const result = validateModelPrediction(raw);
      const category = categoryOf(result);
      return category && result.score >= threshold ? [category] : [];
    }),
  );
}
