import { fiscalCodeCategories } from "./fiscal-code.js";
import { vatCategories } from "./vat.js";
import { italianIbanCategories } from "./italian-iban.js";
import type { Category } from "../model/contracts.js";

function documents(
  text: string,
  category: "IT_IDENTITY_CARD" | "IT_DRIVER_LICENSE",
  form: string,
  context: RegExp,
): ReadonlySet<Category> {
  const pattern = new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}_])(?:${form})(?![\\p{L}\\p{M}\\p{N}_])`,
    "giu",
  );
  return new Set(
    [...text.matchAll(pattern)].some(
      (match) =>
        text.trim() === match[0] ||
        context.test(text.slice(Math.max(0, match.index - 50), match.index)),
    )
      ? [category]
      : [],
  );
}
export function recognizeItalianIdentifiers(
  text: string,
): ReadonlySet<Category> {
  return new Set([
    ...fiscalCodeCategories(text),
    ...vatCategories(text),
    ...italianIbanCategories(text),
    ...documents(
      text,
      "IT_IDENTITY_CARD",
      String.raw`[A-Z]{2}\d{5}[A-Z]{2}|\d{7}[A-Z]{2}`,
      /\b(?:cie|carta\s+(?:di\s+)?identit[àa]|documento)(?!\p{L})/iu,
    ),
    ...documents(
      text,
      "IT_DRIVER_LICENSE",
      String.raw`[A-Z]{2}\d{7}[A-Z]|U1[BCDEFGHLJKMNPRSTUWYXZ0-9]{7}[A-Z]`,
      /\b(?:patente|licenza\s+di\s+guida)\b/iu,
    ),
  ]);
}
