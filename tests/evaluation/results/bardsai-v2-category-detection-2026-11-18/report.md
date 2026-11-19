# Category-detection golden comparison

Gold: `category-detection-1` — 142 cases, 142 successful HTTP responses.

Each case is sent once per engine with `allowedCategories: []`. Metrics compare the observed HTTP business verdict, the complete `{verdict, findings}` body and category presence. Technical or contract failures abort the run and are never scored.

## Summary

| engine | cases | verdictCorrect | verdictIncorrect | bodyMatch | bodyMismatch |
| --- | --- | --- | --- | --- | --- |
| bardsai | 142 | 132 | 10 | 125 | 17 |

## Verdict (positive = rejected)

| engine | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | falseAcceptanceRate | falseRejectionRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bardsai | 142 | 99 | 43 | 96 | 7 | 3 | 36 | 0.9697 | 0.9320 | 0.9296 | 0.9035 | 0.0303 | 0.1628 |

## Categories

| engine | category | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bardsai | PERSON | 142 | 61 | 81 | 58 | 1 | 3 | 80 | 0.9508 | 0.9831 | 0.9718 | 0.9692 |
| bardsai | EMAIL_ADDRESS | 142 | 22 | 120 | 22 | 0 | 0 | 120 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| bardsai | PHONE_NUMBER | 142 | 16 | 126 | 16 | 6 | 0 | 120 | 1.0000 | 0.7273 | 0.9577 | 0.9762 |
| bardsai | IT_FISCAL_CODE | 142 | 14 | 128 | 14 | 0 | 0 | 128 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| bardsai | IT_VAT_CODE | 142 | 6 | 136 | 6 | 1 | 0 | 135 | 1.0000 | 0.8571 | 0.9930 | 0.9963 |
| bardsai | IBAN_CODE | 142 | 8 | 134 | 8 | 1 | 0 | 133 | 1.0000 | 0.8889 | 0.9930 | 0.9963 |
| bardsai | CREDIT_CARD | 142 | 14 | 128 | 14 | 3 | 0 | 125 | 1.0000 | 0.8235 | 0.9789 | 0.9883 |
| bardsai | IT_IDENTITY_CARD | 142 | 4 | 138 | 3 | 0 | 1 | 138 | 0.7500 | 1.0000 | 0.9930 | 0.8750 |
| bardsai | IT_DRIVER_LICENSE | 142 | 5 | 137 | 4 | 0 | 1 | 137 | 0.8000 | 1.0000 | 0.9930 | 0.9000 |

## Differences

| caseId | engine | expectedVerdict | observedVerdict | expectedCategories | observedCategories |
| --- | --- | --- | --- | --- | --- |
| targeted-07 | bardsai | rejected | accepted | ['IT_IDENTITY_CARD'] | [] |
| legacy-person-negative-01 | bardsai | accepted | rejected | [] | ['PERSON'] |
| legacy-mixture-01 | bardsai | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'] | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD'] |
| gretel-5 | bardsai | rejected | rejected | ['PERSON'] | ['PERSON', 'PHONE_NUMBER'] |
| gretel-61 | bardsai | rejected | accepted | ['PERSON'] | [] |
| gretel-184 | bardsai | accepted | rejected | [] | ['PHONE_NUMBER'] |
| gretel-294 | bardsai | rejected | rejected | ['PERSON', 'IBAN_CODE'] | ['IBAN_CODE'] |
| gretel-360 | bardsai | rejected | rejected | ['PERSON', 'PHONE_NUMBER'] | ['PERSON', 'PHONE_NUMBER', 'IBAN_CODE'] |
| gretel-392 | bardsai | rejected | accepted | ['PERSON'] | [] |
| aliasit-57 | bardsai | accepted | rejected | [] | ['CREDIT_CARD'] |
| aliasit-83 | bardsai | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-95 | bardsai | rejected | rejected | ['PERSON'] | ['PERSON', 'CREDIT_CARD'] |
| aliasit-106 | bardsai | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-150 | bardsai | accepted | rejected | [] | ['CREDIT_CARD'] |
| aliasit-154 | bardsai | rejected | rejected | ['PERSON'] | ['PERSON', 'PHONE_NUMBER'] |
| aliasit-176 | bardsai | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER'] |
| aliasit-3254 | bardsai | accepted | rejected | [] | ['IT_VAT_CODE'] |

## Scope

Category presence per complete text; no span or entity-count scoring. The corpus is a development oracle, not a held-out estimate of production representativeness. Accepted is not proof that a text contains no personal data.
