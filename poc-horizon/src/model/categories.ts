import { isItalianDocument } from './semantics.js';
import { isLocatedSpan, isRecord } from './contracts.js';
import type { Category, ModelPrediction, Span } from './contracts.js';

function catalog<const Values extends readonly string[]>(...values: Values): ReadonlySet<Values[number]> {
  return new Set(values);
}
// Single source for the closed application Category union and runtime catalog.
export const CATEGORIES = catalog('PERSON', 'EMAIL_ADDRESS',
  'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'PHONE_NUMBER',
  'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE');
export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && [...CATEGORIES].some(category => category === value);
}

// All 29 known native Horizon labels; only business aliases enter the catalog.
export const LABEL_MAP: Readonly<Record<string, string>> = Object.freeze({
  ACCOUNT_ID: 'ACCOUNT_ID', AGE: 'AGE', BANK_ACCOUNT: 'BANK_ACCOUNT',
  COORDINATE: 'COORDINATE', CREDIT_CARD: 'CREDIT_CARD',
  CREDIT_CARD_CVV: 'CREDIT_CARD_CVV', DATE: 'DATE', DATE_OF_BIRTH: 'DATE_OF_BIRTH',
  DEVICE_ID: 'DEVICE_ID', DRIVER_LICENSE: 'IT_DRIVER_LICENSE',
  EMAIL: 'EMAIL_ADDRESS', IP_ADDRESS: 'IP_ADDRESS', LICENSE_NUMBER: 'LICENSE_NUMBER',
  LOCATION: 'LOCATION', MAC_ADDRESS: 'MAC_ADDRESS', MEDICAL_ID: 'MEDICAL_ID',
  NATIONAL_ID: 'IT_IDENTITY_CARD', ORGANIZATION: 'ORGANIZATION', PASSPORT: 'PASSPORT',
  PASSWORD: 'PASSWORD', PERSON: 'PERSON', PHONE: 'PHONE_NUMBER',
  POSTCODE: 'POSTCODE', SECRET: 'SECRET', STREET_ADDRESS: 'STREET_ADDRESS',
  TAX_ID: 'TAX_ID', URL: 'URL', USERNAME: 'USERNAME', VEHICLE_ID: 'VEHICLE_ID',
});
export const SCORE_THRESHOLD = 0.35; // PoC threshold, not calibrated probability.

export function validateModelPrediction(raw: unknown, text: string): ModelPrediction {
  if (!isRecord(raw)) throw new Error('Invalid model candidate');
  const { entity_group, score, word, start, end } = raw;
  if (typeof entity_group !== 'string' || typeof score !== 'number' ||
      !Number.isFinite(score) || score < 0 || score > 1 ||
      (word !== undefined && typeof word !== 'string')) throw new Error('Invalid model candidate');
  const pair = { start, end };
  let span: Span;
  if (start === undefined && end === undefined) span = {};
  else if (isLocatedSpan(pair, text)) span = { start: pair.start, end: pair.end };
  else throw new Error('Invalid model candidate');
  return { entity_group, score, ...span, ...(word === undefined ? {} : { word }) };
}

export function categoryOf(result: ModelPrediction, text: string): Category | undefined {
  const label = result.entity_group;
  if (!Object.hasOwn(LABEL_MAP, label) && !isCategory(label))
    throw new Error('Unknown model label'); // Fail closed even below threshold.
  const category = Object.hasOwn(LABEL_MAP, label) ? LABEL_MAP[label] : label;
  if (!isCategory(category)) return undefined; // Ignore known extras only after technical checks.
  if ((category === 'IT_IDENTITY_CARD' || category === 'IT_DRIVER_LICENSE') &&
      !isItalianDocument(category, text, result.start, result.end, result.word)) return undefined;
  return category;
}
export function categoriesOf(results: unknown, threshold = SCORE_THRESHOLD, text = ''): Set<Category> {
  if (!Array.isArray(results)) throw new Error('Invalid model results');
  const rawResults: readonly unknown[] = results;
  const found = new Set<Category>();
  for (const raw of rawResults) {
    const result = validateModelPrediction(raw, text);
    const category = categoryOf(result, text);
    if (category && result.score >= threshold) found.add(category);
  }
  return found;
}
export function detectedCategories(text: string, results: unknown, threshold = SCORE_THRESHOLD): Set<Category> {
  return categoriesOf(results, threshold, text);
}
