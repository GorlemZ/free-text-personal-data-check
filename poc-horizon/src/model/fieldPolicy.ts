import type { Category } from './contracts.js';

export function deniedCategories(detected: ReadonlySet<Category>, allowedCategories: readonly Category[]): ReadonlySet<Category> {
  const allowed = new Set(allowedCategories);
  return new Set([...detected].filter(category => !allowed.has(category)));
}
