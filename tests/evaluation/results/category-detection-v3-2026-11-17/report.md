# Category-detection golden comparison

Gold: `category-detection-1` — 142 cases, 426 successful HTTP responses.

Each case is sent once per engine with `allowedCategories: []`. Metrics compare the observed HTTP business verdict, the complete `{verdict, findings}` body and category presence. Technical or contract failures abort the run and are never scored.

## Summary

| engine | cases | verdictCorrect | verdictIncorrect | bodyMatch | bodyMismatch |
| --- | --- | --- | --- | --- | --- |
| rizzo | 142 | 131 | 11 | 113 | 29 |
| horizon | 142 | 135 | 7 | 122 | 20 |
| presidio | 142 | 114 | 28 | 101 | 41 |

## Verdict (positive = rejected)

| engine | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | falseAcceptanceRate | falseRejectionRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rizzo | 142 | 99 | 43 | 97 | 9 | 2 | 34 | 0.9798 | 0.9151 | 0.9225 | 0.8852 | 0.0202 | 0.2093 |
| horizon | 142 | 99 | 43 | 98 | 6 | 1 | 37 | 0.9899 | 0.9423 | 0.9507 | 0.9252 | 0.0101 | 0.1395 |
| presidio | 142 | 99 | 43 | 79 | 8 | 20 | 35 | 0.7980 | 0.9080 | 0.8028 | 0.8060 | 0.2020 | 0.1860 |

## Categories

| engine | category | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| rizzo | PERSON | 142 | 61 | 81 | 59 | 0 | 2 | 81 | 0.9672 | 1.0000 | 0.9859 | 0.9836 |
| rizzo | EMAIL_ADDRESS | 142 | 22 | 120 | 22 | 0 | 0 | 120 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| rizzo | PHONE_NUMBER | 142 | 16 | 126 | 12 | 4 | 4 | 122 | 0.7500 | 0.7500 | 0.9437 | 0.8591 |
| rizzo | IT_FISCAL_CODE | 142 | 14 | 128 | 14 | 3 | 0 | 125 | 1.0000 | 0.8235 | 0.9789 | 0.9883 |
| rizzo | IT_VAT_CODE | 142 | 6 | 136 | 5 | 4 | 1 | 132 | 0.8333 | 0.5556 | 0.9648 | 0.9020 |
| rizzo | IBAN_CODE | 142 | 8 | 134 | 8 | 16 | 0 | 118 | 1.0000 | 0.3333 | 0.8873 | 0.9403 |
| rizzo | CREDIT_CARD | 142 | 14 | 128 | 14 | 4 | 0 | 124 | 1.0000 | 0.7778 | 0.9718 | 0.9844 |
| rizzo | IT_IDENTITY_CARD | 142 | 4 | 138 | 3 | 0 | 1 | 138 | 0.7500 | 1.0000 | 0.9930 | 0.8750 |
| rizzo | IT_DRIVER_LICENSE | 142 | 5 | 137 | 4 | 0 | 1 | 137 | 0.8000 | 1.0000 | 0.9930 | 0.9000 |
| horizon | PERSON | 142 | 61 | 81 | 59 | 0 | 2 | 81 | 0.9672 | 1.0000 | 0.9859 | 0.9836 |
| horizon | EMAIL_ADDRESS | 142 | 22 | 120 | 22 | 1 | 0 | 119 | 1.0000 | 0.9565 | 0.9930 | 0.9958 |
| horizon | PHONE_NUMBER | 142 | 16 | 126 | 16 | 5 | 0 | 121 | 1.0000 | 0.7619 | 0.9648 | 0.9802 |
| horizon | IT_FISCAL_CODE | 142 | 14 | 128 | 14 | 0 | 0 | 128 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| horizon | IT_VAT_CODE | 142 | 6 | 136 | 6 | 1 | 0 | 135 | 1.0000 | 0.8571 | 0.9930 | 0.9963 |
| horizon | IBAN_CODE | 142 | 8 | 134 | 8 | 1 | 0 | 133 | 1.0000 | 0.8889 | 0.9930 | 0.9963 |
| horizon | CREDIT_CARD | 142 | 14 | 128 | 14 | 8 | 0 | 120 | 1.0000 | 0.6364 | 0.9437 | 0.9688 |
| horizon | IT_IDENTITY_CARD | 142 | 4 | 138 | 3 | 0 | 1 | 138 | 0.7500 | 1.0000 | 0.9930 | 0.8750 |
| horizon | IT_DRIVER_LICENSE | 142 | 5 | 137 | 4 | 0 | 1 | 137 | 0.8000 | 1.0000 | 0.9930 | 0.9000 |
| presidio | PERSON | 142 | 61 | 81 | 47 | 12 | 14 | 69 | 0.7705 | 0.7966 | 0.8169 | 0.8112 |
| presidio | EMAIL_ADDRESS | 142 | 22 | 120 | 22 | 0 | 0 | 120 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| presidio | PHONE_NUMBER | 142 | 16 | 126 | 13 | 2 | 3 | 124 | 0.8125 | 0.8667 | 0.9648 | 0.8983 |
| presidio | IT_FISCAL_CODE | 142 | 14 | 128 | 14 | 0 | 0 | 128 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| presidio | IT_VAT_CODE | 142 | 6 | 136 | 3 | 1 | 3 | 135 | 0.5000 | 0.7500 | 0.9718 | 0.7463 |
| presidio | IBAN_CODE | 142 | 8 | 134 | 5 | 0 | 3 | 134 | 0.6250 | 1.0000 | 0.9789 | 0.8125 |
| presidio | CREDIT_CARD | 142 | 14 | 128 | 9 | 0 | 5 | 128 | 0.6429 | 1.0000 | 0.9648 | 0.8214 |
| presidio | IT_IDENTITY_CARD | 142 | 4 | 138 | 4 | 0 | 0 | 138 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| presidio | IT_DRIVER_LICENSE | 142 | 5 | 137 | 3 | 0 | 2 | 137 | 0.6000 | 1.0000 | 0.9859 | 0.8000 |

## Differences

| caseId | engine | expectedVerdict | observedVerdict | expectedCategories | observedCategories |
| --- | --- | --- | --- | --- | --- |
| gretel-38 | presidio | rejected | rejected | ['PERSON', 'CREDIT_CARD'] | ['PERSON'] |
| gretel-96 | presidio | rejected | accepted | ['PERSON'] | [] |
| gretel-128 | presidio | accepted | rejected | [] | ['PERSON'] |
| gretel-282 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IT_VAT_CODE'] |
| gretel-282 | presidio | rejected | accepted | ['PERSON'] | [] |
| gretel-311 | rizzo | accepted | rejected | [] | ['IBAN_CODE'] |
| gretel-311 | presidio | accepted | rejected | [] | ['PERSON'] |
| gretel-313 | rizzo | accepted | rejected | [] | ['IT_VAT_CODE'] |
| gretel-313 | presidio | accepted | rejected | [] | ['PERSON'] |
| gretel-328 | horizon | rejected | rejected | ['PERSON', 'IBAN_CODE'] | ['PERSON', 'IBAN_CODE', 'CREDIT_CARD'] |
| gretel-364 | presidio | rejected | accepted | ['PERSON'] | [] |
| gretel-382 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IT_VAT_CODE', 'IBAN_CODE'] |
| gretel-382 | presidio | rejected | rejected | ['PERSON'] | ['PERSON', 'PHONE_NUMBER'] |
| gretel-431 | presidio | rejected | accepted | ['PERSON'] | [] |
| targeted-00 | presidio | rejected | accepted | ['PERSON'] | [] |
| targeted-02 | rizzo | rejected | rejected | ['PHONE_NUMBER'] | ['IBAN_CODE'] |
| targeted-02 | presidio | rejected | accepted | ['PHONE_NUMBER'] | [] |
| targeted-07 | rizzo | rejected | accepted | ['IT_IDENTITY_CARD'] | [] |
| targeted-07 | horizon | rejected | accepted | ['IT_IDENTITY_CARD'] | [] |
| targeted-10 | presidio | rejected | accepted | ['IT_VAT_CODE'] | [] |
| targeted-11 | presidio | rejected | accepted | ['IBAN_CODE'] | [] |
| targeted-12 | presidio | rejected | accepted | ['CREDIT_CARD'] | [] |
| targeted-21 | presidio | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['EMAIL_ADDRESS'] |
| targeted-22 | horizon | rejected | rejected | ['IBAN_CODE'] | ['IBAN_CODE', 'CREDIT_CARD'] |
| legacy-it-driver-license-s01 | presidio | rejected | rejected | ['IT_DRIVER_LICENSE'] | ['PERSON', 'IT_DRIVER_LICENSE'] |
| legacy-phone-number-s01 | rizzo | rejected | rejected | ['PHONE_NUMBER'] | ['IBAN_CODE'] |
| legacy-iban-code-s01 | presidio | rejected | rejected | ['IBAN_CODE'] | ['PERSON', 'IBAN_CODE'] |
| legacy-iban-code-s02 | presidio | rejected | rejected | ['IBAN_CODE'] | ['PERSON', 'IBAN_CODE'] |
| legacy-phone-number-s04 | rizzo | rejected | accepted | ['PHONE_NUMBER'] | [] |
| legacy-phone-number-s04 | presidio | rejected | accepted | ['PHONE_NUMBER'] | [] |
| legacy-email-address-s05 | presidio | rejected | rejected | ['EMAIL_ADDRESS'] | ['PERSON', 'EMAIL_ADDRESS'] |
| legacy-person-negative-01 | presidio | accepted | rejected | [] | ['PERSON'] |
| legacy-email-address-negative-04 | horizon | accepted | rejected | [] | ['EMAIL_ADDRESS'] |
| legacy-it-vat-code-negative-03 | presidio | rejected | accepted | ['IT_VAT_CODE'] | [] |
| legacy-iban-code-negative-02 | presidio | rejected | rejected | ['IBAN_CODE'] | ['PERSON'] |
| legacy-iban-code-negative-04 | rizzo | accepted | rejected | [] | ['IBAN_CODE'] |
| legacy-credit-card-negative-03 | presidio | rejected | accepted | ['CREDIT_CARD'] | [] |
| legacy-credit-card-isolated | presidio | rejected | accepted | ['CREDIT_CARD'] | [] |
| legacy-it-driver-license-isolated | presidio | rejected | accepted | ['IT_DRIVER_LICENSE'] | [] |
| legacy-mixture-01 | rizzo | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'] | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD'] |
| legacy-mixture-01 | horizon | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'] | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD'] |
| legacy-mixture-01 | presidio | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'] | ['PERSON', 'EMAIL_ADDRESS', 'IT_FISCAL_CODE', 'IT_IDENTITY_CARD'] |
| legacy-phone-vat-overlap | rizzo | rejected | rejected | ['PHONE_NUMBER', 'IT_VAT_CODE'] | ['PHONE_NUMBER'] |
| gretel-5 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IBAN_CODE'] |
| gretel-5 | horizon | rejected | rejected | ['PERSON'] | ['PERSON', 'PHONE_NUMBER'] |
| gretel-5 | presidio | rejected | rejected | ['PERSON'] | ['IT_VAT_CODE'] |
| gretel-17 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IBAN_CODE', 'CREDIT_CARD'] |
| gretel-17 | horizon | rejected | rejected | ['PERSON'] | ['PERSON', 'CREDIT_CARD'] |
| gretel-61 | rizzo | rejected | rejected | ['PERSON'] | ['IBAN_CODE'] |
| gretel-127 | rizzo | accepted | rejected | [] | ['IT_FISCAL_CODE', 'IBAN_CODE'] |
| gretel-151 | presidio | rejected | accepted | ['IT_VAT_CODE'] | [] |
| gretel-248 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'CREDIT_CARD'] |
| gretel-248 | horizon | rejected | rejected | ['PERSON'] | ['PERSON', 'CREDIT_CARD'] |
| gretel-294 | rizzo | rejected | rejected | ['PERSON', 'IBAN_CODE'] | ['IBAN_CODE'] |
| gretel-294 | horizon | rejected | rejected | ['PERSON', 'IBAN_CODE'] | ['IBAN_CODE'] |
| gretel-294 | presidio | rejected | accepted | ['PERSON', 'IBAN_CODE'] | [] |
| gretel-355 | presidio | accepted | rejected | [] | ['PERSON'] |
| gretel-360 | rizzo | rejected | rejected | ['PERSON', 'PHONE_NUMBER'] | ['PERSON', 'IBAN_CODE'] |
| gretel-360 | horizon | rejected | rejected | ['PERSON', 'PHONE_NUMBER'] | ['PERSON', 'PHONE_NUMBER', 'IBAN_CODE'] |
| gretel-360 | presidio | rejected | rejected | ['PERSON', 'PHONE_NUMBER'] | ['PERSON'] |
| gretel-374 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD'] |
| gretel-374 | horizon | rejected | rejected | ['PERSON'] | ['PERSON', 'CREDIT_CARD'] |
| gretel-390 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IBAN_CODE'] |
| gretel-392 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'IBAN_CODE', 'CREDIT_CARD'] |
| gretel-439 | rizzo | accepted | rejected | [] | ['IT_FISCAL_CODE'] |
| gretel-439 | presidio | accepted | rejected | [] | ['PERSON'] |
| aliasit-50 | rizzo | rejected | rejected | ['PERSON', 'CREDIT_CARD'] | ['PERSON', 'IBAN_CODE', 'CREDIT_CARD'] |
| aliasit-50 | presidio | rejected | accepted | ['PERSON', 'CREDIT_CARD'] | [] |
| aliasit-57 | horizon | accepted | rejected | [] | ['CREDIT_CARD'] |
| aliasit-83 | rizzo | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-83 | horizon | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-83 | presidio | accepted | rejected | [] | ['PERSON'] |
| aliasit-95 | horizon | rejected | rejected | ['PERSON'] | ['PERSON', 'CREDIT_CARD'] |
| aliasit-95 | presidio | rejected | accepted | ['PERSON'] | [] |
| aliasit-106 | rizzo | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-106 | horizon | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-137 | presidio | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['EMAIL_ADDRESS'] |
| aliasit-150 | horizon | accepted | rejected | [] | ['CREDIT_CARD'] |
| aliasit-154 | rizzo | rejected | rejected | ['PERSON'] | ['PERSON', 'PHONE_NUMBER'] |
| aliasit-154 | horizon | rejected | rejected | ['PERSON'] | ['PERSON', 'PHONE_NUMBER'] |
| aliasit-154 | presidio | rejected | accepted | ['PERSON'] | [] |
| aliasit-172 | horizon | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['EMAIL_ADDRESS'] |
| aliasit-172 | presidio | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['EMAIL_ADDRESS'] |
| aliasit-176 | rizzo | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER'] |
| aliasit-176 | horizon | rejected | rejected | ['PERSON', 'EMAIL_ADDRESS'] | ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER'] |
| aliasit-3086 | presidio | rejected | accepted | ['PERSON'] | [] |
| aliasit-3205 | rizzo | accepted | rejected | [] | ['IBAN_CODE'] |
| aliasit-3208 | presidio | accepted | rejected | [] | ['PHONE_NUMBER'] |
| aliasit-3254 | horizon | accepted | rejected | [] | ['IT_VAT_CODE'] |
| aliasit-3125 | rizzo | accepted | rejected | [] | ['IBAN_CODE'] |

## Scope

Category presence per complete text; no span or entity-count scoring. The corpus is a development oracle, not a held-out estimate of production representativeness. Accepted is not proof that a text contains no personal data.
