import type { Category } from "./contracts.js";
const MODEL_MAP: Readonly<Record<string, Category | undefined>> = Object.freeze({ FULLNAME: 'PERSON', EMAIL: 'EMAIL_ADDRESS', CF: 'IT_FISCAL_CODE', PIVA: 'IT_VAT_CODE', IBAN: 'IBAN_CODE', CREDITCARDNUMBER: 'CREDIT_CARD' });
// Known native labels from the pinned model config. Unknown labels indicate
// incompatible output, not an innocuous extra category.
const NATIVE_LABELS = new Set(['AGE', 'AMOUNT', 'BUILDINGNUM', 'CATASTO', 'CF', 'CITY',
  'CREDITCARDNUMBER', 'DATE', 'DOCID', 'EMAIL', 'FULLNAME', 'GENDER', 'IBAN', 'ID_DOC',
  'ORG', 'PIVA', 'PROVINCE', 'STREET', 'TARGA', 'TELEPHONENUM', 'TIME', 'ZIPCODE']);
export function interpretSemanticEntities(entities: unknown): Set<Category> {
  if (!Array.isArray(entities)) throw new Error('INVALID_MODEL_OUTPUT');
  const categories = new Set<Category>();
  const native: readonly unknown[] = entities;
  for (const entity of native) {
    const value = entity as Record<string, unknown>;
    if (!entity || !isNativeLabel(value.label) || typeof value.text !== 'string'
      || !finiteNumber(value.score) || value.score < 0 || value.score > 1) throw new Error('INVALID_MODEL_OUTPUT');
    if (value.score < 0.5 || !value.text) continue;
    if (MODEL_MAP[value.label]) categories.add(MODEL_MAP[value.label]!);
    // TELEPHONENUM may omit a foreign prefix. Phone detection is exclusively
    // owned by rules over the original text, never by decoded model fragments.
    // ID_DOC conflates passport/identity/license. Only the explicit local rules distinguish these.
  }
  return categories;
}
function finiteNumber(value: unknown): value is number { return Number.isFinite(value); }
function isNativeLabel(value: unknown): value is string { return typeof value === 'string' && NATIVE_LABELS.has(value); }
// Property reads retain the legacy optional-access behavior for malformed native
// values; callers keep external output unknown until its original validation point.
function property(value: unknown, key: string): unknown {
  return value == null ? undefined : Reflect.get(Object(value), key, value);
}

export function interpretModelOutput(entities: unknown): Set<Category> {
  if (!Array.isArray(entities)) throw new Error("INVALID_MODEL_OUTPUT");
  const native: readonly unknown[] = entities;
  return interpretSemanticEntities(native.map(entity => ({
    label: property(entity, "entity_group"), text: property(entity, "word"), score: property(entity, "score"),
  })));
}
