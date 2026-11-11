export const CATEGORIES: ReadonlySet<string> = new Set(['PERSON', 'EMAIL',
  'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'PHONE_NUMBER', 'PHONE',
  'NATIONAL_ID', 'DRIVER_LICENSE']);

export type RuleCandidate = Readonly<{
  source: 'rule'; category: string; start: number; end: number;
  check: 'not_checked' | 'passed' | 'failed';
}>;
export type ModelCandidate = Readonly<{
  source: 'model'; category: string; start?: number; end?: number; score: number;
}>;
export type Candidate = RuleCandidate | ModelCandidate;
export type Field = Readonly<{
  fieldId: string; text: string; allowedEntityTypes: readonly string[];
}>;

export function assertCandidate(candidate: Candidate, text: string,
                                categories: ReadonlySet<string>): void {
  if (!categories.has(candidate.category) ||
      (candidate.source === 'rule' && (!Number.isInteger(candidate.start) ||
        !Number.isInteger(candidate.end) || candidate.start < 0 ||
        candidate.end <= candidate.start || candidate.end > text.length)) ||
      (candidate.source === 'model' &&
        ((candidate.start === undefined) !== (candidate.end === undefined) ||
         (candidate.start !== undefined && candidate.end !== undefined &&
          (!Number.isInteger(candidate.start) || !Number.isInteger(candidate.end) ||
           candidate.start < 0 || candidate.end <= candidate.start ||
           candidate.end > text.length))))) {
    throw new Error('INVALID_CANDIDATE');
  }
  if (candidate.source === 'model' &&
      (!Number.isFinite(candidate.score) || candidate.score < 0 || candidate.score > 1)) {
    throw new Error('INVALID_CANDIDATE');
  }
  if (candidate.source === 'rule' &&
      !['not_checked', 'passed', 'failed'].includes(candidate.check)) {
    throw new Error('INVALID_CANDIDATE');
  }
}

export function deniedCategories(field: Field, rules: readonly RuleCandidate[],
                                 model: readonly ModelCandidate[], threshold: number,
                                 categories: ReadonlySet<string>): string[] {
  const allowed = new Set(field.allowedEntityTypes);
  const found = new Set<string>();
  for (const candidate of [...rules, ...model]) {
    assertCandidate(candidate, field.text, categories);
    if ((candidate.source === 'rule' && candidate.check !== 'failed') ||
        (candidate.source === 'model' && candidate.score >= threshold)) {
      if (!allowed.has(candidate.category)) found.add(candidate.category);
    }
  }
  return [...found].sort();
}
