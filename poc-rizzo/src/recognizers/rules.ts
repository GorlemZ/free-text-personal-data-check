import type { Category } from '../model/contracts.js';
import { getCountrySpecifications } from 'ibantools';
const ibanLengths = Object.entries(getCountrySpecifications()).filter(([, value]) => value.IBANRegistry && value.chars).map(([country, value]) => [country, value.chars] as const);
const boundary = String.raw`\p{L}\p{N}\p{M}_`;
function matches(text: string, pattern: string): RegExpStringIterator<RegExpExecArray> {
  return text.matchAll(new RegExp(`(?<![${boundary}])(?:${pattern})(?![${boundary}])`, 'giu'));
}
function hasContext(text: string, match: RegExpExecArray, context: RegExp): boolean {
  const before = text.slice(Math.max(0, match.index - 50), match.index);
  return context.test(before) || text.trim() === match[0];
}
export function recognize(text: string): Set<Category> {
  const found = new Set<Category>();
  if ([...matches(text, '[A-Z]{6}[0-9LMNPQRSTUV]{2}[ABCDEHLMPRST][0-9LMNPQRSTUV]{2}[A-Z][0-9LMNPQRSTUV]{3}[A-Z]')].length) found.add('IT_FISCAL_CODE');
  if ([...matches(text, String.raw`[A-Z0-9.!#$%&'*+/=?^_\x60{|}~-]+@[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?(?:\.[A-Z0-9](?:[A-Z0-9-]*[A-Z0-9])?)+`)].length) found.add('EMAIL_ADDRESS');
  for (const value of matches(text, String.raw`(?:IT[ \t]*)?\d{11}`)) {
    if (hasContext(text, value, /\b(?:p\.?\s*iva|partita\s+iva)\b/iu)) found.add('IT_VAT_CODE');
  }
  for (const [country, length] of ibanLengths) {
    if ([...matches(text, `${country}[ \\t]*[0-9][ \\t]*[0-9](?:[ \\t]*[A-Z0-9]){${Number(length) - 4}}`)].length) { found.add('IBAN_CODE'); break; }
  }
  for (const value of matches(text, String.raw`\d(?:[ -]?\d){12,18}`)) {
    if (hasContext(text, value, /\b(?:carta|credito|debito|card|pan)\b/iu)) found.add('CREDIT_CARD');
  }
  for (const value of matches(text, String.raw`(?:\+|00)?\d[\d\p{White_Space}().-]{4,}\d`)) {
    const compact = value[0].replace(/[\p{White_Space}().-]/gu, '');
    // Consume the complete numeric envelope; no retry from a foreign-prefix suffix.
    if ((compact.startsWith('+') && !compact.startsWith('+39')) || (compact.startsWith('00') && !compact.startsWith('0039'))) continue;
    const national = compact.replace(/^(?:\+39|0039)/, '');
    if (/^3\d{9}$/.test(national) || (/^0[1-9]\d{4,9}$/.test(national) && hasContext(text, value, /\b(?:tel(?:efono)?|cell(?:ulare)?|chiam\w*|numero|recapito)\b/iu))) found.add('PHONE_NUMBER');
  }
  for (const value of matches(text, String.raw`(?:[A-Z]{2}\d{5}[A-Z]{2}|\d{7}[A-Z]{2})`)) {
    if (hasContext(text, value, /\b(?:cie|carta\s+(?:di\s+)?identit[àa]|documento)(?!\p{L})/iu)) found.add('IT_IDENTITY_CARD');
  }
  for (const value of matches(text, String.raw`(?:[A-Z]{2}\d{7}[A-Z]|U1[BCDEFGHLJKMNPRSTUWYXZ0-9]{7}[A-Z])`)) {
    if (hasContext(text, value, /\b(?:patente|licenza\s+di\s+guida)\b/iu)) found.add('IT_DRIVER_LICENSE');
  }
  return found;
}
