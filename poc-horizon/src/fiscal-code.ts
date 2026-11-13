// Syntactic, canonical 16-character form only. No checksum, omocodia or registry check.
// The Unicode token boundary prevents accepting a CF-shaped substring of a longer word.
const FISCAL_CODE = /(?<![\p{L}\p{M}\p{N}_])[A-Za-z]{6}[0-9]{2}[ABCDEHLMPRSTabcdehlmprst](?:0[1-9]|[12][0-9]|3[01]|4[1-9]|[56][0-9]|7[01])[A-Za-z][0-9]{3}[A-Za-z](?![\p{L}\p{M}\p{N}_])/u;

export function hasPlausibleFiscalCode(text: string): boolean {
  return FISCAL_CODE.test(text);
}
