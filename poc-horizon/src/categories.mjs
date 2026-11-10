// Full mapping for all 29 Horizon BIO labels. An unmapped name remains native;
// in particular TAX_ID is not an Italian codice fiscale and BANK_ACCOUNT is not IBAN_CODE.
import { hasPlausibleFiscalCode } from './fiscal-code.mjs';
export const LABEL_MAP = Object.freeze({
  ACCOUNT_ID: 'ACCOUNT_ID', AGE: 'AGE', BANK_ACCOUNT: 'BANK_ACCOUNT',
  COORDINATE: 'COORDINATE', CREDIT_CARD: 'CREDIT_CARD',
  CREDIT_CARD_CVV: 'CREDIT_CARD_CVV', DATE: 'DATE', DATE_OF_BIRTH: 'DATE_OF_BIRTH',
  DEVICE_ID: 'DEVICE_ID', DRIVER_LICENSE: 'DRIVER_LICENSE',
  EMAIL: 'EMAIL_ADDRESS', IP_ADDRESS: 'IP_ADDRESS', LICENSE_NUMBER: 'LICENSE_NUMBER',
  LOCATION: 'LOCATION', MAC_ADDRESS: 'MAC_ADDRESS', MEDICAL_ID: 'MEDICAL_ID',
  NATIONAL_ID: 'NATIONAL_ID', ORGANIZATION: 'ORGANIZATION', PASSPORT: 'PASSPORT',
  PASSWORD: 'PASSWORD', PERSON: 'PERSON', PHONE: 'PHONE_NUMBER',
  POSTCODE: 'POSTCODE', SECRET: 'SECRET', STREET_ADDRESS: 'STREET_ADDRESS',
  TAX_ID: 'TAX_ID', URL: 'URL', USERNAME: 'USERNAME', VEHICLE_ID: 'VEHICLE_ID',
});
export const CATEGORIES = new Set([...Object.values(LABEL_MAP), 'IT_FISCAL_CODE',
  'IT_VAT_CODE', 'IBAN_CODE']);
export const SCORE_THRESHOLD = 0.35; // PoC threshold, not a calibrated probability.
export function categoriesOf(results, threshold = SCORE_THRESHOLD) {
  const found = new Set();
  for (const result of results) {
    const category = LABEL_MAP[result.entity_group];
    if (!category) throw new Error('Unknown model label'); // fail closed on revision mismatch.
    if (result.score >= threshold) found.add(category);
  }
  return found;
}
export function detectedCategories(text, results, threshold = SCORE_THRESHOLD) {
  const found = categoriesOf(results, threshold);
  if (hasPlausibleFiscalCode(text)) found.add('IT_FISCAL_CODE');
  return found;
}
