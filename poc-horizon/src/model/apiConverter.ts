import type { Category, FieldAnalysis } from './contracts.js';

export type Finding = Readonly<{ fieldId: string; category: Category }>;
export type AnalyzeResponse = Readonly<{
  verdict: 'accepted' | 'rejected'; findings: readonly Finding[];
}>;
const compare = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;

export function toAnalyzeResponse(analyses: readonly FieldAnalysis[]): AnalyzeResponse {
  const findings = analyses.flatMap(({ fieldId, denied }) => [...denied]
    .map(category => ({ fieldId, category })))
    .sort((a, b) => compare(a.fieldId, b.fieldId) || compare(a.category, b.category));
  return { verdict: findings.length ? 'rejected' : 'accepted', findings };
}
