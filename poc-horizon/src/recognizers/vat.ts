import type { RuleCandidate } from '../model/contracts.js';

// Eleven Italian digits, optionally preceded by IT. No registry/assignment lookup.
const VAT = /(?<![\p{L}\p{M}\p{N}_])(?:[Ii][Tt])?[0-9]{11}(?![\p{L}\p{M}\p{N}_])/gu;
export function validItalianVat(value: string): boolean {
  const digits = value.replace(/^[Ii][Tt]/, '');
  if (!/^[0-9]{11}$/.test(digits) || digits === '00000000000') return false;
  let sum = 0;
  for (let i = 0; i < 10; i++) {
    let digit = digits.charCodeAt(i) - 48;
    if (i % 2 === 1) { digit *= 2; if (digit > 9) digit -= 9; }
    sum += digit;
  }
  return (10 - sum % 10) % 10 === digits.charCodeAt(10) - 48;
}
export function vatCandidates(text: string): RuleCandidate[] {
  return [...text.matchAll(VAT)].map(match => ({
    source: 'rule', category: 'IT_VAT_CODE', start: match.index,
    end: match.index + match[0].length,
    check: validItalianVat(match[0]) ? 'passed' : 'failed',
  }));
}
