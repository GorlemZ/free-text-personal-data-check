// Italian VAT number: 11 decimal digits; a regional prefix or checksum is not required.
// Optional IT prefix denotes the same plausible number, not a proven registration.
const VAT = /(?<![\p{L}\p{M}\p{N}_])(?:IT)?[0-9]{11}(?![\p{L}\p{M}\p{N}_])/giu;

export function vatCandidates(text: string) {
  return [...text.matchAll(VAT)].map(match => ({
    source: 'rule' as const, category: 'IT_VAT_CODE', start: match.index,
    end: match.index + match[0].length, check: 'not_checked' as const,
  }));
}
