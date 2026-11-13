import type { RuleCandidate } from '../model/contracts.js';

// IT + check digits + CIN + ABI(5) + CAB(5) + account(12); ASCII spaces only.
const IBAN = /(?<![\p{L}\p{M}\p{N}_])[Ii][Tt](?: ?[0-9]){2}(?: ?[A-Za-z])(?: ?[0-9]){10}(?: ?[A-Za-z0-9]){12}(?![\p{L}\p{M}\p{N}_])/gu;
const COMPACT = /^IT[0-9]{2}[A-Z][0-9]{10}[A-Z0-9]{12}$/;
const SPACED = /^[Ii][Tt](?: ?[0-9]){2}(?: ?[A-Za-z])(?: ?[0-9]){10}(?: ?[A-Za-z0-9]){12}$/;
export function validItalianIban(value: string): boolean {
  if (!SPACED.test(value)) return false;
  const compact = value.replace(/ /g, '').toUpperCase();
  if (!COMPACT.test(compact)) return false;
  const reordered = compact.slice(4) + compact.slice(0, 4);
  let remainder = 0;
  for (const c of reordered) {
    const expanded = c >= 'A' && c <= 'Z' ? String(c.charCodeAt(0) - 55) : c;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
export function italianIbanCandidates(text: string): RuleCandidate[] {
  return [...text.matchAll(IBAN)].map(match => ({
    source: 'rule', category: 'IBAN_CODE', start: match.index,
    end: match.index + match[0].length,
    check: validItalianIban(match[0]) ? 'passed' : 'failed',
  }));
}
