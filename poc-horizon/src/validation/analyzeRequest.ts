import { isCategory } from "../model/categories.js";
import { isRecord } from "../model/contracts.js";
import type { Field } from "../model/contracts.js";
import { HTTP_LIMITS } from "../config/config.js";
import { InvalidRequest } from "../model/errors.js";

const invalid: () => never = () => {
  throw new InvalidRequest();
};

export function validateAnalyzeRequest(body: string): readonly Field[] {
  const payload: unknown = (() => {
    try {
      return JSON.parse(body) as unknown;
    } catch {
      return invalid();
    }
  })();
  if (
    !isRecord(payload) ||
    Object.keys(payload).join() !== "fields" ||
    !Array.isArray(payload.fields) ||
    payload.fields.length < 1 ||
    payload.fields.length > HTTP_LIMITS.maxFields
  )
    invalid();
  const fields = payload.fields.map((field: unknown): Field => {
    if (
      !isRecord(field) ||
      Object.keys(field).some(
        (key) => !["allowedCategories", "fieldId", "text"].includes(key),
      ) ||
      typeof field.fieldId !== "string" ||
      field.fieldId.length < 1 ||
      field.fieldId.length > HTTP_LIMITS.maxFieldIdUnits ||
      !field.fieldId.isWellFormed() ||
      typeof field.text !== "string" ||
      !field.text.isWellFormed() ||
      field.text.split(/\p{White_Space}+/u).filter(Boolean).length >
        HTTP_LIMITS.maxWords
    )
      invalid();
    const allowed = "allowedCategories" in field ? field.allowedCategories : [];
    if (!Array.isArray(allowed) || !allowed.every(isCategory)) invalid();
    return {
      fieldId: field.fieldId,
      text: field.text,
      allowedCategories: allowed,
    };
  });
  if (new Set(fields.map((field) => field.fieldId)).size !== fields.length)
    invalid();
  return fields;
}
