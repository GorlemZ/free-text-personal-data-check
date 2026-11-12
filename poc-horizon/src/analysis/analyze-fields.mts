import { fiscalCodeCandidates, validFiscalCode } from '../recognizers/fiscal-code.mjs';
import { vatCandidates, validItalianVat } from '../recognizers/vat.mjs';
import { italianIbanCandidates, validItalianIban } from '../recognizers/italian-iban.mjs';
import { creditCardCandidates, validCreditCard } from '../recognizers/credit-card.mjs';
import { italianPhoneCandidates, validItalianPhone } from '../recognizers/italian-phone.mjs';
import { isItalianPhone } from './semantics.mjs';
import { CATEGORIES } from './contracts.mjs';
import type { Candidate, Field, RuleCandidate } from './contracts.mjs';

export type Prepared = Readonly<{ text: string }>;
export type ModelResult = Readonly<{
  entity_group: string; score: number; start?: number; end?: number;
}>;
export type Adapter = Readonly<{
  prepare(text: string): Promise<Prepared> | Prepared;
  infer(prepared: Prepared): Promise<readonly ModelResult[]>;
}>;
export type Recognizer = (text: string) => readonly RuleCandidate[];
export type CategoryResolver = (results: readonly ModelResult[], threshold: number, text?: string) => Set<string>;
export type FieldAnalysis = Readonly<{
  fieldId: string; detected: ReadonlySet<string>; possible: ReadonlySet<string>;
  denied: ReadonlySet<string>; candidates: readonly Candidate[];
}>;

const structuredChecks: Readonly<Record<string, (value: string) => boolean>> = {
  IT_FISCAL_CODE: validFiscalCode,
  IT_VAT_CODE: validItalianVat,
  IBAN_CODE: validItalianIban,
  CREDIT_CARD: validCreditCard,
  PHONE_NUMBER: value => validItalianPhone(value) && isItalianPhone(value),
};
const structuredRecognizers: Readonly<Record<string, Recognizer>> = {
  IT_FISCAL_CODE: fiscalCodeCandidates,
  IT_VAT_CODE: vatCandidates,
  IBAN_CODE: italianIbanCandidates,
  CREDIT_CARD: creditCardCandidates,
  PHONE_NUMBER: italianPhoneCandidates,
};
function modelSpanValid(category: string, result: ModelResult, text: string): boolean {
  const recognize = structuredRecognizers[category];
  // Validate the exact span in its original context, not an isolated substring:
  // embedded tokens and grouped numeric fragments must obey rule boundaries.
  if (category === 'PHONE_NUMBER' && !isItalianPhone(text.slice(result.start, result.end))) return false;
  return !recognize || (result.start !== undefined && result.end !== undefined &&
    recognize(text).some(candidate => candidate.start === result.start &&
      candidate.end === result.end && candidate.check === 'passed'));
}

export async function analyzeFields(fields: readonly Field[], adapter: Adapter,
                                    recognize: Recognizer, categoriesOf: CategoryResolver,
                                    threshold: number): Promise<FieldAnalysis[]> {
  const prepared: Prepared[] = [];
  for (const field of fields) prepared.push(await adapter.prepare(field.text));
  const analyses: FieldAnalysis[] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    const rules = recognize(field.text);
    const model = await adapter.infer(prepared[index]);
    if (!Array.isArray(model) || !Array.isArray(rules)) throw new Error('INVALID_RESULTS');
    const detected = new Set<string>();
    const possible = new Set<string>();
    const candidates: Candidate[] = [];
    for (const candidate of rules) {
      if (candidate.source !== 'rule' || !Number.isInteger(candidate.start) ||
        !Number.isInteger(candidate.end) || candidate.start < 0 ||
        candidate.end > field.text.length || candidate.end <= candidate.start ||
        !CATEGORIES.has(candidate.category) ||
        !['not_checked', 'passed', 'failed'].includes(candidate.check)) {
        throw new Error('INVALID_RULE_CANDIDATE');
      }
      candidates.push({ source: 'rule', category: candidate.category,
        start: candidate.start, end: candidate.end, check: candidate.check });
      if (candidate.check !== 'failed' &&
          (!structuredChecks[candidate.category] ||
           structuredChecks[candidate.category](field.text.slice(candidate.start, candidate.end)))) {
        detected.add(candidate.category);
        possible.add(candidate.category);
      }
    }
    for (const result of model) {
      // Resolve even below-threshold labels: an unknown model revision is an error.
      const [category] = categoriesOf([result], 0, field.text);
      if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1 ||
        (result.start === undefined) !== (result.end === undefined) ||
        (result.start !== undefined && result.end !== undefined &&
         (!Number.isInteger(result.start) || !Number.isInteger(result.end) ||
          result.start < 0 || result.end <= result.start ||
          result.end > field.text.length))) throw new Error('INVALID_MODEL_CANDIDATE');
      // Known native labels outside the nine-label application catalog are ignored.
      if (!category) continue;
      const candidate: Candidate = { source: 'model', category, score: result.score,
        ...(result.start === undefined ? {} : { start: result.start, end: result.end }) };
      candidates.push(candidate);
      if (!modelSpanValid(category, result, field.text)) continue;
      possible.add(category);
      if (result.score >= threshold) detected.add(category);
    }
    const allowed = new Set(field.allowedCategories);
    const denied = new Set([...detected].filter(category => !allowed.has(category)));
    analyses.push({ fieldId: field.fieldId, detected, possible, denied, candidates });
  }
  return analyses;
}
