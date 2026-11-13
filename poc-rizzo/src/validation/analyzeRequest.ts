import { CATEGORIES } from '../model/categories.js';
import type { Category, Field } from '../model/contracts.js';

const knownCategories: ReadonlySet<unknown> = new Set(CATEGORIES);
const objectWithKeys = (value: unknown, keys: readonly string[]): value is Record<string, unknown> => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
interface RawField { fieldId: string; text: string; allowedCategories?: Category[] }

function validPayload(payload: unknown): payload is { fields: RawField[] } {
  if (!objectWithKeys(payload, ['fields']) || !Array.isArray(payload.fields)
    || payload.fields.length < 1 || payload.fields.length > 10) return false;
  const ids = new Set<string>();
  const fields: readonly unknown[] = payload.fields;
  for (const field of fields) {
    if (!objectWithKeys(field, ['fieldId', 'text', 'allowedCategories'])
      || typeof field.fieldId !== 'string' || field.fieldId.length === 0 || field.fieldId.length > 128
      || !field.fieldId.isWellFormed() || ids.has(field.fieldId) || typeof field.text !== 'string' || !field.text.isWellFormed()
      || field.text.split(/\p{White_Space}+/u).filter(Boolean).length > 50) return false;
    if (Object.hasOwn(field, 'allowedCategories') && (!Array.isArray(field.allowedCategories)
      || !field.allowedCategories.every((category: unknown) => knownCategories.has(category)))) return false;
    ids.add(field.fieldId);
  }
  return true;
}

export function analyzeRequest(payload: unknown): readonly Field[] | undefined {
  if (!validPayload(payload)) return undefined;
  return payload.fields.map(field => ({ fieldId: field.fieldId, text: field.text, allowedCategories: field.allowedCategories ?? [] }));
}
