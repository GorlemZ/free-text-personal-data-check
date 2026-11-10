// Syntactic, canonical 16-character form only; no checksum, omocodia or registry check.
// The Unicode token boundary prevents accepting a CF-shaped substring of a longer word.
const FISCAL_CODE = /(?<![\p{L}\p{M}\p{N}_])[A-Za-z]{6}[0-9]{2}[ABCDEHLMPRSTabcdehlmprst](?:0[1-9]|[12][0-9]|3[01]|4[1-9]|[56][0-9]|7[01])[A-Za-z][0-9]{3}[A-Za-z](?![\p{L}\p{M}\p{N}_])/gu;

export function fiscalCodeCandidates(text: string) {
  return [...text.matchAll(FISCAL_CODE)].map(match => ({
    source: 'rule' as const, category: 'IT_FISCAL_CODE', start: match.index,
    end: match.index + match[0].length, check: 'not_checked' as const,
  }));
}
