import { isCategory } from '../model/categories.js';
import { isRecord } from '../model/contracts.js';
import type { Field } from '../model/contracts.js';
import { HTTP_LIMITS } from '../config/config.js';
import { InvalidRequest } from '../model/errors.js';
import { strictParse } from './strictJson.js';

const invalid: () => never = () => { throw new InvalidRequest(); };

export function validateAnalyzeRequest(body: string): readonly Field[] {
  let payload: unknown;
  try { payload = strictParse(body); } catch { invalid(); }
  if (!isRecord(payload) || Object.keys(payload).join() !== 'fields' ||
      !Array.isArray(payload.fields) || payload.fields.length < 1 ||
      payload.fields.length > HTTP_LIMITS.maxFields) invalid();
  const ids = new Set<string>();
  return payload.fields.map((field: unknown): Field => {
    if (!isRecord(field) ||
        Object.keys(field).some(key => !['allowedCategories', 'fieldId', 'text'].includes(key)) ||
        typeof field.fieldId !== 'string' || field.fieldId.length < 1 ||
        field.fieldId.length > HTTP_LIMITS.maxFieldIdUnits || ids.has(field.fieldId) ||
        typeof field.text !== 'string' ||
        field.text.split(/\p{White_Space}+/u).filter(Boolean).length > HTTP_LIMITS.maxWords) invalid();
    const allowed = 'allowedCategories' in field ? field.allowedCategories : [];
    if (!Array.isArray(allowed) || !allowed.every(isCategory)) invalid();
    ids.add(field.fieldId);
    return { fieldId: field.fieldId, text: field.text, allowedCategories: allowed };
  });
}
