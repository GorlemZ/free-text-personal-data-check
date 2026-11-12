import { parsePhoneNumberWithError } from 'libphonenumber-js/max';

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
