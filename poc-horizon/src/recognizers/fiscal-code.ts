import type { Category } from "../model/contracts.js";

// Recognizable CF morphology; checksum and registry assignment do not gate detection.
const FISCAL_CODE =
  /(?<![\p{L}\p{M}\p{N}_])[A-Za-z]{6}[0-9]{2}[ABCDEHLMPRSTabcdehlmprst](?:0[1-9]|[12][0-9]|3[01]|4[1-9]|[56][0-9]|7[01])[A-Za-z][0-9]{3}[A-Za-z](?![\p{L}\p{M}\p{N}_])/gu;
const ODD = "BAKPLCQDREVOSFTGUHMINJWZYX";
const EVEN = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const DIGIT_ODD = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21];

export function validFiscalCode(value: string): boolean {
  return CANONICAL.test(value) && fiscalChecksum(value);
}
const CANONICAL =
  /^[A-Za-z]{6}[0-9]{2}[ABCDEHLMPRSTabcdehlmprst](?:0[1-9]|[12][0-9]|3[01]|4[1-9]|[56][0-9]|7[01])[A-Za-z][0-9]{3}[A-Za-z]$/;
function fiscalChecksum(value: string): boolean {
  const code = value.toUpperCase();
  const sum = [...code.slice(0, 15)].reduce((total, c, index) => {
    const digit = c >= "0" && c <= "9" ? c.charCodeAt(0) - 48 : -1;
    return (
      total +
      (index % 2 === 0
        ? digit >= 0
          ? DIGIT_ODD[digit]
          : ODD.indexOf(c)
        : digit >= 0
          ? digit
          : EVEN.indexOf(c))
    );
  }, 0);
  return code[15] === EVEN[sum % 26];
}
export function fiscalCodeCategories(text: string): ReadonlySet<Category> {
  return new Set(
    [...text.matchAll(FISCAL_CODE)].length > 0 ? ["IT_FISCAL_CODE"] : [],
  );
}
