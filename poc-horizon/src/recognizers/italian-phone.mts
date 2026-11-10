import type { RuleCandidate } from '../analysis/contracts.mjs';

// Domestic mobile 3 + nine digits or landline 0 + 5–10 digits; optional +39/0039.
// No subscriber-allocation check; international numbers for other countries are excluded.
const PHONE = /(?<![\p{L}\p{M}\p{N}_+])(?:\+39|0039)?(?:3[0-9]{9}|0[0-9]{5,10})(?![\p{L}\p{M}\p{N}_])/gu;
export function validItalianPhone(value: string): boolean {
  return /^(?:\+39|0039)?(?:3[0-9]{9}|0[0-9]{5,10})$/.test(value);
}
export function italianPhoneCandidates(text: string): RuleCandidate[] {
  return [...text.matchAll(PHONE)].map(match => ({
    source: 'rule', category: 'PHONE_NUMBER', start: match.index,
    end: match.index + match[0].length, check: 'passed',
  }));
}
