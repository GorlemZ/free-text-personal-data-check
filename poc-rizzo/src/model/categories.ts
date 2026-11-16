export const CATEGORIES = Object.freeze([
  "PERSON",
  "EMAIL_ADDRESS",
  "PHONE_NUMBER",
  "IT_FISCAL_CODE",
  "IT_VAT_CODE",
  "IBAN_CODE",
  "CREDIT_CARD",
  "IT_IDENTITY_CARD",
  "IT_DRIVER_LICENSE",
] as const);

export type Category = (typeof CATEGORIES)[number];

export const CATEGORY_SOURCES: Readonly<Record<Category, "model" | "rule">> =
  Object.freeze({
    PERSON: "model",
    EMAIL_ADDRESS: "model",
    PHONE_NUMBER: "model",
    IT_FISCAL_CODE: "model",
    IT_VAT_CODE: "model",
    IBAN_CODE: "model",
    CREDIT_CARD: "model",
    IT_IDENTITY_CARD: "rule",
    IT_DRIVER_LICENSE: "rule",
  });
