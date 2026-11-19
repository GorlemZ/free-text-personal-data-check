import { CATEGORIES } from "./categories.js";
import type { Category, Field, Finding } from "./contracts.js";
const knownCategories: ReadonlySet<string> = new Set(CATEGORIES);
function isCategory(value: unknown): value is Category {
  return typeof value === "string" && knownCategories.has(value);
}

export function mergeCategories(
  learned: ReadonlySet<Category>,
  ruled: ReadonlySet<Category>,
): ReadonlySet<Category> {
  if (!(learned instanceof Set)) throw new Error("invalid_detector_result");
  return new Set([...learned, ...ruled]);
}
export function fieldPolicy(
  field: Field,
  categories: ReadonlySet<Category>,
  allowed: ReadonlySet<Category>,
): readonly Finding[] {
  return [...categories].flatMap((category) => {
    if (!isCategory(category)) throw new Error("invalid_detector_category");
    return allowed.has(category) ? [] : [{ fieldId: field.fieldId, category }];
  });
}
