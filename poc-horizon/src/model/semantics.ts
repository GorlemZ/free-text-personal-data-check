import { parsePhoneNumberWithError } from 'libphonenumber-js/max';
import { fiscalCodeCandidates, validFiscalCode } from '../recognizers/fiscal-code.js';
import { vatCandidates, validItalianVat } from '../recognizers/vat.js';
import { italianIbanCandidates, validItalianIban } from '../recognizers/italian-iban.js';
import { creditCardCandidates, validCreditCard } from '../recognizers/credit-card.js';
import { italianPhoneCandidates, validItalianPhone } from '../recognizers/italian-phone.js';
import type { Category, ModelPrediction, RuleCandidate } from './contracts.js';

const structuredChecks: Readonly<Partial<Record<Category, (value: string) => boolean>>> = {
  IT_FISCAL_CODE: validFiscalCode,
  IT_VAT_CODE: validItalianVat,
  IBAN_CODE: validItalianIban,
  CREDIT_CARD: validCreditCard,
  PHONE_NUMBER: value => validItalianPhone(value) && isItalianPhone(value),
};
const structuredRecognizers: Readonly<Partial<Record<Category, (text: string) => readonly RuleCandidate[]>>> = {
  IT_FISCAL_CODE: fiscalCodeCandidates,
  IT_VAT_CODE: vatCandidates,
  IBAN_CODE: italianIbanCandidates,
  CREDIT_CARD: creditCardCandidates,
  PHONE_NUMBER: italianPhoneCandidates,
};
export function ruleCategoryValid(category: Category, value: string): boolean {
  return structuredChecks[category]?.(value) ?? true;
}
export function modelSpanValid(category: Category, result: ModelPrediction, text: string): boolean {
  const recognize = structuredRecognizers[category];
  // Keep original-text boundaries/checksums; never validate an isolated token instead.
  if (category === 'PHONE_NUMBER' && !isItalianPhone(text.slice(result.start, result.end))) return false;
  return !recognize || (result.start !== undefined && result.end !== undefined &&
    recognize(text).some(candidate => candidate.start === result.start &&
      candidate.end === result.end && candidate.check === 'passed'));
}

// Geography is a business projection, not a change to recognizer validity.
export function isItalianPhone(value: string): boolean {
  const compact = value.replace(/[() -]/g, '');
  const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  try {
    return parsePhoneNumberWithError(normalized, { defaultCountry: 'IT', extract: false }).country === 'IT';
  } catch { return false; }
}

const TOKEN = /[\p{L}\p{M}\p{N}_]/u;
const forms: Readonly<Record<string, RegExp>> = {
  IT_IDENTITY_CARD: /^(?:[A-Z]{2}\d{5}[A-Z]{2}|\d{7}[A-Z]{2})$/i,
  IT_DRIVER_LICENSE: /^(?:[A-Z]{2}\d{7}[A-Z]|U1[BCDEFGHLJKMNPRSTUWYXZ0-9]{7}[A-Z])$/i,
};
const contexts: Readonly<Record<string, RegExp>> = {
  IT_IDENTITY_CARD: /\b(?:cie|carta\s+(?:di\s+)?identit[àa]|documento)(?!\p{L})/iu,
  IT_DRIVER_LICENSE: /\b(?:patente|licenza\s+di\s+guida)\b/iu,
};

// A native generic document label is not evidence of Italian nationality.
// Require an exact original span, Italian shape, standalone value or context.
export function isItalianDocument(category: string, text: string,
                                  start?: number, end?: number, word?: unknown): boolean {
  if (start === undefined && end === undefined) {
    // Transformers.js grouped output has no offsets. Associate only its literal
    // decoded document word (edge whitespace aside), never a generic ID search.
    // Count all occurrences before context/boundary filtering to avoid guessing.
    if (typeof word !== 'string') return false;
    const literal = word.trim();
    if (literal.length === 0) return false;
    start = text.indexOf(literal);
    if (start < 0 || text.indexOf(literal, start + 1) !== -1) return false;
    end = start + literal.length;
  }
  if (start === undefined || end === undefined || !forms[category]) return false;
  const value = text.slice(start, end);
  if (!forms[category].test(value) ||
      TOKEN.test([...text.slice(0, start)].at(-1) ?? '') ||
      TOKEN.test([...text.slice(end)][0] ?? '')) return false;
  return text.trim() === value || contexts[category].test(text.slice(Math.max(0, start - 50), start));
}
