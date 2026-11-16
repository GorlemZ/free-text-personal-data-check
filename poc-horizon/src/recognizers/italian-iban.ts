import type { Category } from "../model/contracts.js";

// ISO 13616 morphology: country, check digits and 11-30 BBAN characters.
// Detection accepts compact values or conventional four-character groups.
const COMPACT_IBAN =
  /(?<![\p{L}\p{M}\p{N}_])[A-Za-z]{2}[0-9]{2}[A-Za-z0-9]{11,}(?![\p{L}\p{M}\p{N}_])/gu;
const GROUPED_IBAN =
  /(?<![\p{L}\p{M}\p{N}_])[A-Za-z]{2}[0-9]{2}(?: [A-Za-z0-9]{4}){2,}(?: [A-Za-z0-9]{1,3})?(?![\p{L}\p{M}\p{N}_])/gu;
const COMPACT = /^IT[0-9]{2}[A-Z][0-9]{10}[A-Z0-9]{12}$/;
const SPACED =
  /^[Ii][Tt](?: ?[0-9]){2}(?: ?[A-Za-z])(?: ?[0-9]){10}(?: ?[A-Za-z0-9]){12}$/;
export function validItalianIban(value: string): boolean {
  if (!SPACED.test(value)) return false;
  const compact = value.replace(/ /g, "").toUpperCase();
  if (!COMPACT.test(compact)) return false;
  const reordered = compact.slice(4) + compact.slice(0, 4);
  const remainder = [...reordered].reduce((previous, c) => {
    const expanded = c >= "A" && c <= "Z" ? String(c.charCodeAt(0) - 55) : c;
    return [...expanded].reduce(
      (partial, digit) => (partial * 10 + Number(digit)) % 97,
      previous,
    );
  }, 0);
  return remainder === 1;
}
export function italianIbanCategories(text: string): ReadonlySet<Category> {
  const candidates = [
    ...text.matchAll(COMPACT_IBAN),
    ...text.matchAll(GROUPED_IBAN),
  ];
  return new Set(
    candidates.some((match) => {
      const length = match[0].replaceAll(" ", "").length;
      return length >= 15 && length <= 34;
    })
      ? ["IBAN_CODE"]
      : [],
  );
}
