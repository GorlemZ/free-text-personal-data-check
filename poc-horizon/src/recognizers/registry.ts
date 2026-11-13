import { fiscalCodeCandidates } from './fiscal-code.js';
import { vatCandidates } from './vat.js';
import { italianIbanCandidates } from './italian-iban.js';
import { creditCardCandidates } from './credit-card.js';
import { phoneCandidates } from './phone.js';
import type { RuleCandidate } from '../model/contracts.js';

export function recognizeItalianIdentifiers(text: string): RuleCandidate[] {
  return [
    ...fiscalCodeCandidates(text),
    ...vatCandidates(text),
    ...italianIbanCandidates(text),
    ...creditCardCandidates(text),
    ...phoneCandidates(text),
  ];
}
