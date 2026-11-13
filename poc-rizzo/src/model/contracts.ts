export type Category = 'PERSON' | 'EMAIL_ADDRESS' | 'PHONE_NUMBER' | 'IT_FISCAL_CODE' | 'IT_VAT_CODE'
  | 'IBAN_CODE' | 'CREDIT_CARD' | 'IT_IDENTITY_CARD' | 'IT_DRIVER_LICENSE';
export interface Field { readonly fieldId: string; readonly text: string; readonly allowedCategories: readonly Category[] }
export interface Finding { readonly fieldId: string; readonly category: Category }
// External SDK output is deliberately unknown until the original interpretation boundary.
export interface RawInferenceResult { readonly output: unknown }
export type RawInference = (text: string) => Promise<RawInferenceResult>;
export type Detection = (text: string) => unknown | Promise<unknown>;
export type Analysis = (fields: readonly Field[]) => readonly Finding[] | Promise<readonly Finding[]>;
