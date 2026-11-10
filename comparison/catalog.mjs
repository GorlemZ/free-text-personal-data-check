export const TARGET_CATEGORIES = Object.freeze(['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD']);
export const HORIZON_SUPPORTED = new Set(TARGET_CATEGORIES);
export const FIELD_IDS = Object.freeze([
  'description', 'contactName', 'serverUrls[].description', 'eserviceName',
  'eserviceDescription', 'intendedTarget', 'purposeDescription',
  'freeOfChargeReason', 'riskAnalysisAnswer', 'consumerNotes', 'rejectAgreementReason',
]);
