# Merged pilot: implementer review and import ledger

All 82 distinct complete literals (54 preserved + 28 imported), all 91 scenarios and 92 fields were read during consolidation. All nine category decisions were considered for each field (828 scenario-field/category decisions). No detector predictions were inspected for selection or annotation. Independent agent review `deleg_535a5d99`, task 3, subsequently reread all 82 complete texts, 91 scenarios and 828 decisions before new predictions: **PASS**, no annotation corrections or blocker/high/medium findings. This is not human validation. The original per-case review metadata is retained as historical provenance; `mergedReview` records approval of the consolidated artifact.

## Decisions and limits

- The first 53 case objects, including their original annotations/provenance/review metadata, are unchanged. Their 54 texts were already measured: this is not heldout data. Original grammatical/anagraphic inconsistencies, XML/CSV formatting, masked Italian phones and known correlated threads are preserved rather than rewritten.
- Six original generic ID_DOC cases retain both document categories as unknown; gretel-96 retains an unknown Italian licence. Unknown is not negative. A clear foreign licence mention without any value (import index 258) is negative, not an invented Italian identity.
- Four full-shape checksum failures imported from old negative scenarios (243, 266, 269, 274) are now positive. Independent arithmetic tests confirm CF/VAT/IBAN/Luhn failure without importing a detector.
- Current scope: Italian phones and Italian document forms; international email/IBAN/cards; recognizable identifiers do not require valid checksum, issuance or assignment. Recognizable CF omocodia is allowed, but no complete omocodia or foreign-phone literal exists in this pinned source to import. No text was invented to fill those gaps. Existing foreign IBAN positives remain.
- Whole-candidate boundaries and sufficient form matter: truncated phone/IBAN, an internal token containing a CIE-like substring, double-dot mailbox, street eponym, service name and colour adjective are negative. None of those selected confounders has an incidental positive in the nine-category catalog.
- The 28 imported texts contribute 38 original policy scenarios. Text is byte-identical to the pinned source and is never assembled, truncated or normalized. Repeated text/scenarios retain their historical family; repeated detection probes weight scenario-field metrics, not independent texts. Single surnames (including the preserved surname-only targeted-00) are not a claim that every personal mention is surname-only. The imported technician has a complete name with one surname; the mixture retains a minority compound surname.
- Selection targets missing formats/context, not quotas: UCO U1, short/long cards, VAT/phone overlap, cf/CF and cc/conto corrente, compact phones, email signature and confusing negatives. No label or text was changed to favor a detector. Sources are synthetic/external fixtures; real-world non-assignment and training non-exposure are not established.

## Full selected-ID list and rationale

Pinned source: `38360c8d7f776c075457e319bd957502a03c963b`, `comparison/corpus.json`, `comparison/gold.json`, `comparison/manifest.json`. All current IDs below have the `legacy-` prefix; source case ID is exactly the remainder. Provenance in gold retains source index, family, scenario, provenance kind, revision and rationale. Historical source reviews do not approve these new annotations.

| Added ID | Source text index | Why retained |
| --- | ---: | --- |
| legacy-it-fiscal-code-s01 | 1 | Lowercase cf in an ordinary appointment request; retain its exact allowlist scenario. |
| legacy-it-fiscal-code-s01-allow | 1 | Lowercase cf in an ordinary appointment request; retain its exact allowlist scenario. |
| legacy-it-driver-license-s01 | 4 | UCO U1 licence subtype absent from the original pilot; preserve exact allowlisted scenario. |
| legacy-it-driver-license-s01-allow | 4 | UCO U1 licence subtype absent from the original pilot; preserve exact allowlisted scenario. |
| legacy-phone-number-s01 | 5 | Compact national mobile in a loading-bay coordination message. |
| legacy-it-vat-code-s01 | 6 | VAT in a supplier invoice context; scarce VAT coverage in the original pilot. |
| legacy-iban-code-s01 | 7 | cc shorthand with an alphanumeric Italian account; unrelated PERSON allowlist must not exempt it. |
| legacy-iban-code-s01-wrong | 7 | cc shorthand with an alphanumeric Italian account; unrelated PERSON allowlist must not exempt it. |
| legacy-it-fiscal-code-s02 | 10 | Uppercase CF in a school-registration request rather than a generic label/value fixture. |
| legacy-it-identity-card-s02 | 12 | CIE serial in a duplicate application; preserve complete nine-category allowlist scenario. |
| legacy-it-identity-card-s02-all | 12 | CIE serial in a duplicate application; preserve complete nine-category allowlist scenario. |
| legacy-iban-code-s02 | 16 | Expanded conto corrente cue and a distinct reimbursement context. |
| legacy-credit-card-s03 | 26 | 13-digit card-like value in payment context; short supported card length. |
| legacy-phone-number-s04 | 32 | Short cell shorthand with a compact national mobile. |
| legacy-email-address-s05 | 38 | Multiline message ending in an email signature, not an inline label/value sentence. |
| legacy-person-s06 | 45 | Personal technician context with a single surname that is also an ordinary noun; preserves complete name. |
| legacy-person-negative-01 | 230 | Rosa is part of a service name, not a person in this complete context. |
| legacy-person-negative-02 | 231 | Verdi is a street eponym, not an incidental personal mention. |
| legacy-person-negative-03 | 232 | Lowercase rosa is a colour adjective, not a person. |
| legacy-email-address-negative-04 | 239 | Double-dot domain is malformed mailbox syntax, not a checksum-only mutation; no valid whole mailbox. |
| legacy-it-fiscal-code-negative-02 | 243 | Full recognizable CF with wrong check letter: old negative becomes positive under the current goal. |
| legacy-it-identity-card-negative-03 | 250 | CIE-shaped substring inside a longer internal folder token; no standalone document candidate. |
| legacy-it-driver-license-negative-05 | 258 | Foreign-licence mention with no identifier and an empty Italian subtype section; no document presence. |
| legacy-phone-number-negative-04 | 263 | Very short +39 fragment has insufficient subscriber digits; distinct from a complete recognizable phone. |
| legacy-it-vat-code-negative-03 | 266 | Full recognizable VAT with wrong final checksum digit: old negative becomes positive. |
| legacy-iban-code-negative-02 | 269 | Complete Italian IBAN with wrong checksum: old negative becomes positive, not an administrative-validity gate. |
| legacy-iban-code-negative-04 | 271 | Incomplete foreign bank token lacks a complete country-specific IBAN shape; international scope alone does not make it positive. |
| legacy-credit-card-negative-03 | 274 | 13-digit card-like value with wrong Luhn digit in explicit payment context: old negative becomes positive. |
| legacy-credit-card-isolated | 282 | 19-digit isolated card-like value; long supported card length without context. |
| legacy-it-driver-license-isolated | 284 | Isolated recognizable UCO U1 licence without contextual cue. |
| legacy-mixture-01 | 285 | Five-category mixture including CIE/UCO and a minority compound surname; retain deny-all, partial and full policies. |
| legacy-mixture-01-partial | 285 | Five-category mixture including CIE/UCO and a minority compound surname; retain deny-all, partial and full policies. |
| legacy-mixture-01-full | 285 | Five-category mixture including CIE/UCO and a minority compound surname; retain deny-all, partial and full policies. |
| legacy-phone-vat-overlap | 289 | Same complete candidate explicitly serves as both Italian landline and VAT; preserve five original policy scenarios. |
| legacy-phone-vat-overlap-phone-only | 289 | Same complete candidate explicitly serves as both Italian landline and VAT; preserve five original policy scenarios. |
| legacy-phone-vat-overlap-vat-only | 289 | Same complete candidate explicitly serves as both Italian landline and VAT; preserve five original policy scenarios. |
| legacy-phone-vat-overlap-all | 289 | Same complete candidate explicitly serves as both Italian landline and VAT; preserve five original policy scenarios. |
| legacy-phone-vat-overlap-wrong | 289 | Same complete candidate explicitly serves as both Italian landline and VAT; preserve five original policy scenarios. |

## Exhaustive annotation ledger

P=PERSON; E=EMAIL_ADDRESS; T=PHONE_NUMBER; F=IT_FISCAL_CODE; V=IT_VAT_CODE; I=IBAN_CODE; C=CREDIT_CARD; D=IT_IDENTITY_CARD; L=IT_DRIVER_LICENSE. — means none. Every unlisted/non-unknown category was read as negative, not inferred merely from incomplete upstream spans. Policy is derived from these positives minus the field allowlist.

| Case | Field | Positive | Unknown | Allowed | Expected policy |
| --- | --- | --- | --- | --- | --- |
| `rizzo-2266` | `description` | P E T D L | — | — | rejected |
| `rizzo-2335` | `description` | P | — | — | rejected |
| `rizzo-14989` | `description` | P E T C | — | — | rejected |
| `rizzo-15085` | `description` | P E T F C | D L | — | rejected |
| `rizzo-15127` | `description` | P E T F C | D L | — | rejected |
| `rizzo-15224` | `description` | P E T F C | D L | — | rejected |
| `rizzo-15261` | `description` | P E T F C | D L | — | rejected |
| `rizzo-15265` | `description` | P T F | D L | — | rejected |
| `rizzo-15285` | `description` | P E T F C | D L | — | rejected |
| `rizzo-26377` | `description` | P | — | — | rejected |
| `gretel-38` | `description` | P C | — | — | rejected |
| `gretel-50` | `description` | P | — | — | rejected |
| `gretel-60` | `description` | — | — | — | accepted |
| `gretel-96` | `description` | P | L | — | rejected |
| `gretel-114` | `description` | — | — | — | accepted |
| `gretel-128` | `description` | — | — | — | accepted |
| `gretel-146` | `description` | P E | — | — | rejected |
| `gretel-256` | `description` | P | — | — | rejected |
| `gretel-282` | `description` | P | — | — | rejected |
| `gretel-311` | `description` | — | — | — | accepted |
| `gretel-313` | `description` | — | — | — | accepted |
| `gretel-321` | `description` | P | — | — | rejected |
| `gretel-328` | `description` | P I | — | — | rejected |
| `gretel-364` | `description` | P | — | — | rejected |
| `gretel-382` | `description` | P | — | — | rejected |
| `gretel-421` | `description` | P | — | — | rejected |
| `gretel-431` | `description` | P | — | — | rejected |
| `gretel-443` | `description` | P | — | — | rejected |
| `targeted-00` | `description` | P | — | — | rejected |
| `targeted-01` | `description` | E | — | — | rejected |
| `targeted-02` | `description` | T | — | — | rejected |
| `targeted-03` | `description` | F | — | — | rejected |
| `targeted-04` | `description` | V | — | — | rejected |
| `targeted-05` | `description` | I | — | — | rejected |
| `targeted-06` | `description` | C | — | — | rejected |
| `targeted-07` | `description` | D | — | — | rejected |
| `targeted-08` | `description` | L | — | — | rejected |
| `targeted-09` | `description` | F | — | — | rejected |
| `targeted-10` | `description` | V | — | — | rejected |
| `targeted-11` | `description` | I | — | — | rejected |
| `targeted-12` | `description` | C | — | — | rejected |
| `targeted-13` | `description` | — | — | — | accepted |
| `targeted-14` | `description` | — | — | — | accepted |
| `targeted-15` | `description` | — | — | — | accepted |
| `targeted-16` | `description` | — | — | — | accepted |
| `targeted-17` | `description` | — | — | — | accepted |
| `targeted-18` | `description` | P | — | P | accepted |
| `targeted-19` | `description` | E | — | P | rejected |
| `targeted-20` | `description` | P E | — | P | rejected |
| `targeted-21` | `description` | P E | — | P E T F V I C D L | accepted |
| `targeted-22` | `description` | I | — | — | rejected |
| `targeted-23` | `description` | C | — | — | rejected |
| `targeted-24` | `contactName` | P | — | P | rejected |
| `targeted-24` | `eserviceDescription` | T | — | — | rejected |
| `legacy-it-fiscal-code-s01` | `description` | F | — | — | rejected |
| `legacy-it-fiscal-code-s01-allow` | `description` | F | — | F | accepted |
| `legacy-it-driver-license-s01` | `description` | L | — | — | rejected |
| `legacy-it-driver-license-s01-allow` | `description` | L | — | L | accepted |
| `legacy-phone-number-s01` | `description` | T | — | — | rejected |
| `legacy-it-vat-code-s01` | `description` | V | — | — | rejected |
| `legacy-iban-code-s01` | `description` | I | — | — | rejected |
| `legacy-iban-code-s01-wrong` | `description` | I | — | P | rejected |
| `legacy-it-fiscal-code-s02` | `eserviceDescription` | F | — | — | rejected |
| `legacy-it-identity-card-s02` | `eserviceDescription` | D | — | — | rejected |
| `legacy-it-identity-card-s02-all` | `eserviceDescription` | D | — | P E T F V I C D L | accepted |
| `legacy-iban-code-s02` | `eserviceDescription` | I | — | — | rejected |
| `legacy-credit-card-s03` | `purposeDescription` | C | — | — | rejected |
| `legacy-phone-number-s04` | `riskAnalysisAnswer` | T | — | — | rejected |
| `legacy-email-address-s05` | `consumerNotes` | E | — | — | rejected |
| `legacy-person-s06` | `intendedTarget` | P | — | — | rejected |
| `legacy-person-negative-01` | `eserviceName` | — | — | — | accepted |
| `legacy-person-negative-02` | `description` | — | — | — | accepted |
| `legacy-person-negative-03` | `purposeDescription` | — | — | — | accepted |
| `legacy-email-address-negative-04` | `eserviceDescription` | — | — | — | accepted |
| `legacy-it-fiscal-code-negative-02` | `description` | F | — | — | rejected |
| `legacy-it-identity-card-negative-03` | `riskAnalysisAnswer` | — | — | — | accepted |
| `legacy-it-driver-license-negative-05` | `rejectAgreementReason` | — | — | — | accepted |
| `legacy-phone-number-negative-04` | `purposeDescription` | — | — | — | accepted |
| `legacy-it-vat-code-negative-03` | `riskAnalysisAnswer` | V | — | — | rejected |
| `legacy-iban-code-negative-02` | `consumerNotes` | I | — | — | rejected |
| `legacy-iban-code-negative-04` | `purposeDescription` | — | — | — | accepted |
| `legacy-credit-card-negative-03` | `riskAnalysisAnswer` | C | — | — | rejected |
| `legacy-credit-card-isolated` | `description` | C | — | — | rejected |
| `legacy-it-driver-license-isolated` | `description` | L | — | — | rejected |
| `legacy-mixture-01` | `riskAnalysisAnswer` | P E F D L | — | — | rejected |
| `legacy-mixture-01-partial` | `riskAnalysisAnswer` | P E F D L | — | P | rejected |
| `legacy-mixture-01-full` | `riskAnalysisAnswer` | P E F D L | — | P E T F V I C D L | accepted |
| `legacy-phone-vat-overlap` | `consumerNotes` | T V | — | — | rejected |
| `legacy-phone-vat-overlap-phone-only` | `consumerNotes` | T V | — | T | rejected |
| `legacy-phone-vat-overlap-vat-only` | `consumerNotes` | T V | — | V | rejected |
| `legacy-phone-vat-overlap-all` | `consumerNotes` | T V | — | T V | accepted |
| `legacy-phone-vat-overlap-wrong` | `consumerNotes` | T V | — | P | rejected |
