import { isItalianDocument } from '../dist/analysis/semantics.mjs';
import { CATEGORIES } from '../dist/analysis/contracts.mjs';
// All 29 known Horizon BIO labels; business aliases are handled separately.
// TAX_ID is not an Italian fiscal code; BANK_ACCOUNT is not IBAN_CODE.

export const LABEL_MAP = Object.freeze({
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
export { CATEGORIES };
export const SCORE_THRESHOLD = 0.35; // PoC threshold, not a calibrated probability.
export function categoriesOf(results, threshold = SCORE_THRESHOLD, text = '') {
  if (!Array.isArray(results)) throw new Error('Invalid model results');
  const found = new Set();
  for (const result of results) {
    if (!result || Array.isArray(result) || typeof result !== 'object' ||
        typeof result.entity_group !== 'string' || !Number.isFinite(result.score) ||
        (result.word !== undefined && typeof result.word !== 'string') ||
        result.score < 0 || result.score > 1 ||
        (result.start === undefined) !== (result.end === undefined) ||
        (result.start !== undefined && (!Number.isInteger(result.start) ||
          !Number.isInteger(result.end) || result.start < 0 || result.end <= result.start ||
          result.end > text.length))) throw new Error('Invalid model candidate');
    const label = result.entity_group;
    if (!Object.hasOwn(LABEL_MAP, label) && !CATEGORIES.has(label))
      throw new Error('Unknown model label'); // fail closed even below threshold.
    const category = Object.hasOwn(LABEL_MAP, label) ? LABEL_MAP[label] : label;
    if (!CATEGORIES.has(category)) continue; // Only known extras may be ignored.
    if ((category === 'IT_IDENTITY_CARD' || category === 'IT_DRIVER_LICENSE') &&
        !isItalianDocument(category, text, result.start, result.end, result.word)) continue;
    if (result.score >= threshold) found.add(category);
  }
  return found;
}
export function detectedCategories(text, results, threshold = SCORE_THRESHOLD) {
  // Rules and the original-span/checksum gates run in analyzeFields.
  return categoriesOf(results, threshold, text);
}
