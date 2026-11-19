import type { Category } from "../model/contracts.js";

// Eleven Italian digits, optionally preceded by IT. Checksum does not gate detection.
const VAT =
  /(?<![\p{L}\p{M}\p{N}_])(?:[Ii][Tt])?[0-9]{11}(?![\p{L}\p{M}\p{N}_])/gu;
export function validItalianVat(value: string): boolean {
  const digits = value.replace(/^[Ii][Tt]/, "");
  if (!/^[0-9]{11}$/.test(digits) || digits === "00000000000") return false;
  const sum = [...digits.slice(0, 10)].reduce((total, char, index) => {
    const digit = Number(char) * (index % 2 === 1 ? 2 : 1);
    return total + (digit > 9 ? digit - 9 : digit);
  }, 0);
  return (10 - (sum % 10)) % 10 === digits.charCodeAt(10) - 48;
}
export function vatCategories(text: string): ReadonlySet<Category> {
  return new Set(
    [...text.matchAll(VAT)].some(
      (match) => match[0].replace(/^[Ii][Tt]/, "") !== "00000000000",
    )
      ? ["IT_VAT_CODE"]
      : [],
  );
}
