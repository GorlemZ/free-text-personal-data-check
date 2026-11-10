// Italian IBAN: IT + two check digits + one CIN letter + five ABI digits + five CAB
// digits + twelve alphanumeric account characters, totalling 27 characters.
// Separators are only ASCII spaces; checksums, bank registry and account validity
// are intentionally not required by the plausible-shape policy.
const IBAN = /(?<![\p{L}\p{M}\p{N}_])[Ii][Tt](?: ?[0-9]){2}(?: ?[A-Za-z])(?: ?[0-9]){10}(?: ?[A-Za-z0-9]){12}(?![\p{L}\p{M}\p{N}_])/gu;

export function italianIbanCandidates(text: string) {
  return [...text.matchAll(IBAN)].map(match => ({
    source: 'rule' as const, category: 'IBAN_CODE', start: match.index,
    end: match.index + match[0].length, check: 'not_checked' as const,
  }));
}
