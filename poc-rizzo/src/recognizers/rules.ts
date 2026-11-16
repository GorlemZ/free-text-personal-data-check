import type { Category } from '../model/contracts.js';
import { CATEGORY_SOURCES } from '../model/categories.js';

const documents: readonly Readonly<{ category: Category; form: string; context: RegExp }>[] = [
  { category: 'IT_IDENTITY_CARD', form: String.raw`[A-Z]{2}\d{5}[A-Z]{2}|\d{7}[A-Z]{2}`,
    context: /\b(?:cie|carta\s+(?:di\s+)?identit[àa]|documento)(?!\p{L})/iu },
  { category: 'IT_DRIVER_LICENSE', form: String.raw`[A-Z]{2}\d{7}[A-Z]|U1[BCDEFGHLJKMNPRSTUWYXZ0-9]{7}[A-Z]`,
    context: /\b(?:patente|licenza\s+di\s+guida)\b/iu },
];
export function recognize(text: string): ReadonlySet<Category> {
  return new Set(documents.filter(({ category, form, context }) => CATEGORY_SOURCES[category] === 'rule' &&
    [...text.matchAll(new RegExp(`(?<![\\p{L}\\p{N}\\p{M}_])(?:${form})(?![\\p{L}\\p{N}\\p{M}_])`, 'giu'))]
      .some(match => text.trim() === match[0] || context.test(text.slice(Math.max(0, match.index - 50), match.index))))
    .map(({ category }) => category));
}
