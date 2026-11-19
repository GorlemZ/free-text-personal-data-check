import { isCategory, CATEGORY_SOURCES } from "./categories.js";
import { isRecord } from "./contracts.js";
import type { Category, DecoderPrediction } from "./contracts.js";

export const LABEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  PERSON_NAME: "PERSON",
  EMAIL_ADDRESS: "EMAIL_ADDRESS",
  PHONE_NUMBER: "PHONE_NUMBER",
  PAYMENT_CARD: "CREDIT_CARD",
});

// Complete v2 native inventory. Known labels outside the business catalog are
// deliberately ignored; a label absent from this closed set is a model/schema
// mismatch and fails closed.
const NATIVE_LABELS: ReadonlySet<string> = new Set([
  "PERSON_NAME",
  "PERSON_ALIAS",
  "PERSON_IDENTIFIER",
  "PERSON_ATTRIBUTE",
  "PERSON_ROLE_OR_TITLE",
  "DATE_OF_BIRTH",
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "CONTACT_HANDLE",
  "POSTAL_ADDRESS",
  "LOCATION",
  "GEO_LOCATION",
  "IP_ADDRESS",
  "DEVICE_IDENTIFIER",
  "IDENTIFYING_LINK",
  "ACCOUNT_IDENTIFIER",
  "AUTH_SECRET",
  "BANK_ACCOUNT_IDENTIFIER",
  "PAYMENT_CARD",
  "PAYMENT_CARD_SECURITY",
  "FINANCIAL_AMOUNT",
  "DOCUMENT_IDENTIFIER",
  "DOCUMENT_REFERENCE",
  "VEHICLE_IDENTIFIER",
  "ORGANIZATION_NAME",
  "ORGANIZATION_IDENTIFIER",
  "PROPER_NAME",
  "HEALTH_DATA",
  "BIOMETRIC_DATA",
  "ETHNIC_ORIGIN",
  "POLITICAL_OPINION",
  "RELIGION_OR_BELIEF",
  "SEXUAL_ORIENTATION",
  "TRADE_UNION_MEMBERSHIP",
  "CRIMINAL_OFFENCE_DATA",
]);

function validateModelPrediction(raw: unknown): DecoderPrediction {
  if (!isRecord(raw)) throw new Error("Invalid model candidate");
  const { label, start, end } = raw;
  if (
    typeof label !== "string" ||
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    (start as number) < 0 ||
    (end as number) <= (start as number)
  )
    throw new Error("Invalid model candidate");
  return { label, start: start as number, end: end as number };
}

function categoryOf(result: DecoderPrediction): Category | undefined {
  if (!NATIVE_LABELS.has(result.label)) throw new Error("Unknown model label");
  if (!Object.hasOwn(LABEL_MAP, result.label)) return undefined;
  const category = LABEL_MAP[result.label];
  return isCategory(category) && CATEGORY_SOURCES[category] === "model"
    ? category
    : undefined;
}

export function categoriesOf(results: unknown): ReadonlySet<Category> {
  if (!Array.isArray(results)) throw new Error("Invalid model results");
  return new Set(
    results.flatMap((raw) => {
      const result = validateModelPrediction(raw);
      const category = categoryOf(result);
      return category ? [category] : [];
    }),
  );
}
