import { CATEGORIES } from "./categories.js";
import type { Category, Field, Finding } from "./contracts.js";
const knownCategories: ReadonlySet<unknown> = new Set(CATEGORIES);
function isCategory(value: unknown): value is Category {
  return knownCategories.has(value);
}

export function mergeCategories(
  learned: unknown,
  ruled: ReadonlySet<Category>,
): ReadonlySet<Category> {
  if (!(learned instanceof Set)) throw new Error("invalid_detector_result");
  return new Set([...(learned as Set<Category>), ...ruled]);
}
export function fieldPolicy(
  field: Field,
  categories: ReadonlySet<unknown>,
  allowed: ReadonlySet<unknown>,
): readonly Finding[] {
  return [...categories].flatMap((category) => {
    if (!isCategory(category)) throw new Error("invalid_detector_category");
    return allowed.has(category) ? [] : [{ fieldId: field.fieldId, category }];
  });
}
