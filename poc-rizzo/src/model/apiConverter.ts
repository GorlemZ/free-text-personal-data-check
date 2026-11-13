import type { Finding } from './contracts.js';
export function apiConverter(findings: readonly Finding[]): { readonly verdict: 'accepted' | 'rejected'; readonly findings: readonly Finding[] } {
  const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
  const sorted = findings.map(({ fieldId, category }) => ({ fieldId, category })).sort((a, b) => compare(a.fieldId, b.fieldId) || compare(a.category, b.category));
  return { verdict: sorted.length ? 'rejected' : 'accepted', findings: sorted };
}
