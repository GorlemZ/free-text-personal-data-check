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
    const detected = categoriesOf(model, threshold);
    const possible = categoriesOf(model, 0);
    const candidates: Candidate[] = [];
    for (const candidate of rules) {
      if (candidate.source !== 'rule' || !Number.isInteger(candidate.start) ||
        !Number.isInteger(candidate.end) || candidate.start < 0 ||
        candidate.end > field.text.length || candidate.end <= candidate.start ||
        !['not_checked', 'passed', 'failed'].includes(candidate.check)) {
        throw new Error('INVALID_RULE_CANDIDATE');
      }
      candidates.push({ source: 'rule', category: candidate.category,
        start: candidate.start, end: candidate.end, check: candidate.check });
      detected.add(candidate.category);
      possible.add(candidate.category);
    }
    for (const result of model) {
      const [category] = categoriesOf([result], 0);
      if (!category || !Number.isFinite(result.score) || result.score < 0 ||
          result.score > 1) throw new Error('INVALID_MODEL_CANDIDATE');
      const candidate: Candidate = { source: 'model', category, score: result.score,
        ...(result.start === undefined ? {} : { start: result.start }),
        ...(result.end === undefined ? {} : { end: result.end }) };
      if ((candidate.start === undefined) !== (candidate.end === undefined) ||
          (candidate.start !== undefined && candidate.end !== undefined &&
           (!Number.isInteger(candidate.start) || !Number.isInteger(candidate.end) ||
            candidate.start < 0 || candidate.end <= candidate.start ||
            candidate.end > field.text.length))) throw new Error('INVALID_MODEL_CANDIDATE');
      candidates.push(candidate);
    }
    const allowed = new Set(field.allowedEntityTypes);
    const denied = new Set([...detected].filter(category => !allowed.has(category)));
    analyses.push({ fieldId: field.fieldId, detected, possible, denied, candidates });
  }
  return analyses;
}
