import { validFiscalCode } from '../recognizers/fiscal-code.mjs';
import { validItalianVat } from '../recognizers/vat.mjs';
import { validItalianIban } from '../recognizers/italian-iban.mjs';
import { validCreditCard } from '../recognizers/credit-card.mjs';
import { validItalianPhone } from '../recognizers/italian-phone.mjs';
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
export type CategoryResolver = (results: readonly ModelResult[], threshold: number) => Set<string>;
export type FieldAnalysis = Readonly<{
  fieldId: string; detected: ReadonlySet<string>; possible: ReadonlySet<string>;
  denied: ReadonlySet<string>; candidates: readonly Candidate[];
}>;

const structuredChecks: Readonly<Record<string, (value: string) => boolean>> = {
  IT_FISCAL_CODE: validFiscalCode,
  IT_VAT_CODE: validItalianVat,
  IBAN_CODE: validItalianIban,
  CREDIT_CARD: validCreditCard,
  PHONE_NUMBER: validItalianPhone,
};
function modelSpanValid(category: string, result: ModelResult, text: string): boolean {
  const check = structuredChecks[category];
  // A spanless classification cannot substantiate a format-specific finding.
  return !check || (result.start !== undefined && result.end !== undefined &&
    check(text.slice(result.start, result.end)));
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
      const [category] = categoriesOf([result], 0);
      if (!Number.isFinite(result.score) || result.score < 0 || result.score > 1 ||
        (result.start === undefined) !== (result.end === undefined) ||
        (result.start !== undefined && result.end !== undefined &&
         (!Number.isInteger(result.start) || !Number.isInteger(result.end) ||
          result.start < 0 || result.end <= result.start ||
          result.end > field.text.length))) throw new Error('INVALID_MODEL_CANDIDATE');
      // Known native labels outside the seven-category application catalog are ignored.
      if (!category) continue;
      const candidate: Candidate = { source: 'model', category, score: result.score,
        ...(result.start === undefined ? {} : { start: result.start, end: result.end }) };
      candidates.push(candidate);
      if (!modelSpanValid(category, result, field.text)) continue;
      possible.add(category);
      if (result.score >= threshold) detected.add(category);
    }
    const allowed = new Set(field.allowedEntityTypes);
    const denied = new Set([...detected].filter(category => !allowed.has(category)));
    analyses.push({ fieldId: field.fieldId, detected, possible, denied, candidates });
  }
  return analyses;
}
