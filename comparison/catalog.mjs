export const TARGET_CATEGORIES = Object.freeze([
  'PERSON', 'ORGANIZATION', 'LOCATION', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
  'CREDIT_CARD', 'IP_ADDRESS', 'MAC_ADDRESS', 'URL', 'IT_FISCAL_CODE',
  'IT_DRIVER_LICENSE', 'IT_IDENTITY_CARD', 'IT_PASSPORT', 'IT_VAT_CODE',
  'IBAN_CODE', 'CRYPTO', 'DATE_TIME', 'MEDICAL_LICENSE',
]);
export const HORIZON_SUPPORTED = new Set([
  'PERSON', 'ORGANIZATION', 'LOCATION', 'EMAIL_ADDRESS', 'PHONE_NUMBER',
  'CREDIT_CARD', 'IP_ADDRESS', 'MAC_ADDRESS', 'URL', 'IT_FISCAL_CODE',
  'IT_VAT_CODE', 'IBAN_CODE',
]);
export const FIELD_IDS = Object.freeze([
  'description', 'contactName', 'serverUrls[].description', 'eserviceName',
  'eserviceDescription', 'intendedTarget', 'purposeDescription',
  'freeOfChargeReason', 'riskAnalysisAnswer', 'consumerNotes', 'rejectAgreementReason',
]);
