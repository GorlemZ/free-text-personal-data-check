import { fiscalCodeCandidates } from './fiscal-code.mjs';
import { vatCandidates } from './vat.mjs';
import { italianIbanCandidates } from './italian-iban.mjs';
import { creditCardCandidates } from './credit-card.mjs';
import { italianPhoneCandidates } from './italian-phone.mjs';
import type { RuleCandidate } from '../analysis/contracts.mjs';

export function recognizeItalianIdentifiers(text: string): RuleCandidate[] {
  return [
    ...fiscalCodeCandidates(text),
    ...vatCandidates(text),
    ...italianIbanCandidates(text),
    ...creditCardCandidates(text),
    ...italianPhoneCandidates(text),
  ];
}
