import type { RuleCandidate } from '../model/contracts.js';

// 13–19 ASCII digits; spaces or hyphens between groups (not at ends).
// Match the same 13–19 digits as the validator, even when every pair has a separator.
// Do not begin at a separated suffix of a longer grouped digit sequence.
const CARD = /(?<![\p{L}\p{M}\p{N}_+])(?<![0-9][ -])[0-9](?:[ -]?[0-9]){12,18}(?![ -]?[0-9]|[\p{L}\p{M}\p{N}_])/gu;
export function validCreditCard(value: string): boolean {
  if (!/^[0-9]+(?:[ -][0-9]+)*$/.test(value)) return false;
  const digits = value.replace(/[ -]/g, '');
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  for (let i = digits.length - 1, double = false; i >= 0; i--, double = !double) {
    let digit = digits.charCodeAt(i) - 48;
    if (double) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return sum % 10 === 0;
}
export function creditCardCandidates(text: string): RuleCandidate[] {
  return [...text.matchAll(CARD)].map(match => ({
    source: 'rule', category: 'CREDIT_CARD', start: match.index,
    end: match.index + match[0].length,
    check: validCreditCard(match[0]) ? 'passed' : 'failed',
  }));
}
