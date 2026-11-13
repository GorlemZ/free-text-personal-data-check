import { CATEGORIES } from './categories.js';
import type { Category, Field, Finding } from './contracts.js';
const knownCategories: ReadonlySet<unknown> = new Set(CATEGORIES);
function isCategory(value: unknown): value is Category { return knownCategories.has(value); }

export function mergeCategories(learned: unknown, ruled: ReadonlySet<Category>): Set<unknown> {
  if (!(learned instanceof Set)) throw new Error('invalid_detector_result');
  return new Set([...learned as Set<unknown>, ...ruled]);
}
export function fieldPolicy(field: Field, categories: ReadonlySet<unknown>, allowed: ReadonlySet<unknown>): readonly Finding[] {
  const findings: Finding[] = [];
  for (const category of categories) {
    if (!isCategory(category)) throw new Error('invalid_detector_category');
    if (!allowed.has(category)) findings.push({ fieldId: field.fieldId, category });
  }
  return findings;
}
