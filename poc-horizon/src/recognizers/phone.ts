import { parsePhoneNumberWithError } from 'libphonenumber-js/max';
import type { RuleCandidate } from '../model/contracts.js';

// Consume the entire numeric envelope before checking boundaries or validity.
// Never search again inside a malformed international number for a valid suffix.
const ENVELOPE = /[+0-9()][+0-9() -]*/g;
const TOKEN = /[\p{L}\p{M}\p{N}_]/u;
export function validPhone(value: string): boolean {
  if (!/^\+?[0-9() -]+$/.test(value)) return false;
  let depth = 0;
  for (const char of value) {
    if (char === '(' && ++depth > 1) return false;
    if (char === ')' && --depth < 0) return false;
  }
  if (depth !== 0) return false;
  const compact = value.replace(/[() -]/g, '');
  const normalized = compact.startsWith('00') ? `+${compact.slice(2)}` : compact;
  try {
    return parsePhoneNumberWithError(normalized, { defaultCountry: 'IT', extract: false }).isValid();
  } catch { return false; }
}
export function phoneCandidates(text: string): RuleCandidate[] {
  const candidates: RuleCandidate[] = [];
  for (const match of text.matchAll(ENVELOPE)) {
    const value = match[0].trimEnd();
    const start = match.index;
    const end = start + value.length;
    if (TOKEN.test([...text.slice(0, start)].at(-1) ?? '') || TOKEN.test([...text.slice(end)][0] ?? '') || !validPhone(value)) continue;
    candidates.push({ source: 'rule', category: 'PHONE_NUMBER', start, end, check: 'passed' });
  }
  return candidates;
}
