# Uniform three-engine pilot

Complete: True

Detection: deny-all POST; category presence per case/field, not spans or entity counts. Policy: separate HTTP POST with field allowlists. Same closed nine-category API for all engines. No inferred or normalized verdicts. Matrices use successful requests paired across ALL THREE engines, separately per probe. Unknown pairs are excluded, never TN; zero denominators are N/A.

## Source inventory

| source | cases | fields | distinctTexts | families | unknownPairs |
| --- | --- | --- | --- | --- | --- |
| gretel | 18 | 18 | 18 | 4 | 1 |
| legacy | 38 | 38 | 28 | 21 | 0 |
| rizzo | 10 | 10 | 10 | 2 | 12 |
| targeted | 25 | 26 | 26 | 21 | 0 |
| ALL | 91 | 92 | 82 | 48 | 13 |

## Coverage (own successes; failures never scored)

| source | engine | probe | planned | attempted | success | technical_failure | contract_failure | unattempted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gretel | rizzo | detection | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | horizon | detection | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | presidio | detection | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | rizzo | policy | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | horizon | policy | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | presidio | policy | 18 | 18 | 18 | 0 | 0 | 0 |
| legacy | rizzo | detection | 38 | 38 | 38 | 0 | 0 | 0 |
| legacy | horizon | detection | 38 | 38 | 38 | 0 | 0 | 0 |
| legacy | presidio | detection | 38 | 38 | 38 | 0 | 0 | 0 |
| legacy | rizzo | policy | 38 | 38 | 38 | 0 | 0 | 0 |
| legacy | horizon | policy | 38 | 38 | 38 | 0 | 0 | 0 |
| legacy | presidio | policy | 38 | 38 | 38 | 0 | 0 | 0 |
| rizzo | rizzo | detection | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | horizon | detection | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | presidio | detection | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | rizzo | policy | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | horizon | policy | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | presidio | policy | 10 | 10 | 10 | 0 | 0 | 0 |
| targeted | rizzo | detection | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | horizon | detection | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | presidio | detection | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | rizzo | policy | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | horizon | policy | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | presidio | policy | 25 | 25 | 25 | 0 | 0 | 0 |
| ALL | rizzo | detection | 91 | 91 | 91 | 0 | 0 | 0 |
| ALL | horizon | detection | 91 | 91 | 91 | 0 | 0 | 0 |
| ALL | presidio | detection | 91 | 91 | 91 | 0 | 0 | 0 |
| ALL | rizzo | policy | 91 | 91 | 91 | 0 | 0 | 0 |
| ALL | horizon | policy | 91 | 91 | 91 | 0 | 0 | 0 |
| ALL | presidio | policy | 91 | 91 | 91 | 0 | 0 | 0 |

## Paired successes

| source | detection | policy |
| --- | --- | --- |
| gretel | 18 | 18 |
| legacy | 38 | 38 |
| rizzo | 10 | 10 |
| targeted | 25 | 25 |
| ALL | 91 | 91 |

## Detection

| source | engine | category | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | unknownExcluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gretel | rizzo | PERSON | 18 | 13 | 5 | 13 | 0 | 0 | 5 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | rizzo | EMAIL_ADDRESS | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | rizzo | PHONE_NUMBER | 18 | 0 | 18 | 0 | 1 | 0 | 17 | N/A | 0.0000 | 0.9444 | N/A | 0 |
| gretel | rizzo | IT_FISCAL_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | rizzo | IT_VAT_CODE | 18 | 0 | 18 | 0 | 4 | 0 | 14 | N/A | 0.0000 | 0.7778 | N/A | 0 |
| gretel | rizzo | IBAN_CODE | 18 | 1 | 17 | 1 | 2 | 0 | 15 | 1.0000 | 0.3333 | 0.8889 | 0.9412 | 0 |
| gretel | rizzo | CREDIT_CARD | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | rizzo | IT_IDENTITY_CARD | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | rizzo | IT_DRIVER_LICENSE | 17 | 0 | 17 | 0 | 0 | 0 | 17 | N/A | N/A | 1.0000 | N/A | 1 |
| gretel | horizon | PERSON | 18 | 13 | 5 | 13 | 0 | 0 | 5 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | horizon | EMAIL_ADDRESS | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | horizon | PHONE_NUMBER | 18 | 0 | 18 | 0 | 2 | 0 | 16 | N/A | 0.0000 | 0.8889 | N/A | 0 |
| gretel | horizon | IT_FISCAL_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | horizon | IT_VAT_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | horizon | IBAN_CODE | 18 | 1 | 17 | 0 | 0 | 1 | 17 | 0.0000 | N/A | 0.9444 | 0.5000 | 0 |
| gretel | horizon | CREDIT_CARD | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | horizon | IT_IDENTITY_CARD | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | horizon | IT_DRIVER_LICENSE | 17 | 0 | 17 | 0 | 0 | 0 | 17 | N/A | N/A | 1.0000 | N/A | 1 |
| gretel | presidio | PERSON | 18 | 13 | 5 | 8 | 3 | 5 | 2 | 0.6154 | 0.7273 | 0.5556 | 0.5077 | 0 |
| gretel | presidio | EMAIL_ADDRESS | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | presidio | PHONE_NUMBER | 18 | 0 | 18 | 0 | 1 | 0 | 17 | N/A | 0.0000 | 0.9444 | N/A | 0 |
| gretel | presidio | IT_FISCAL_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | presidio | IT_VAT_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | presidio | IBAN_CODE | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | presidio | CREDIT_CARD | 18 | 1 | 17 | 0 | 0 | 1 | 17 | 0.0000 | N/A | 0.9444 | 0.5000 | 0 |
| gretel | presidio | IT_IDENTITY_CARD | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | presidio | IT_DRIVER_LICENSE | 17 | 0 | 17 | 0 | 0 | 0 | 17 | N/A | N/A | 1.0000 | N/A | 1 |
| legacy | rizzo | PERSON | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | EMAIL_ADDRESS | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | PHONE_NUMBER | 38 | 7 | 31 | 2 | 0 | 5 | 31 | 0.2857 | 1.0000 | 0.8684 | 0.6429 | 0 |
| legacy | rizzo | IT_FISCAL_CODE | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | IT_VAT_CODE | 38 | 7 | 31 | 2 | 0 | 5 | 31 | 0.2857 | 1.0000 | 0.8684 | 0.6429 | 0 |
| legacy | rizzo | IBAN_CODE | 38 | 4 | 34 | 4 | 2 | 0 | 32 | 1.0000 | 0.6667 | 0.9474 | 0.9706 | 0 |
| legacy | rizzo | CREDIT_CARD | 38 | 3 | 35 | 3 | 0 | 0 | 35 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | IT_IDENTITY_CARD | 38 | 5 | 33 | 5 | 0 | 0 | 33 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | IT_DRIVER_LICENSE | 38 | 6 | 32 | 3 | 0 | 3 | 32 | 0.5000 | 1.0000 | 0.9211 | 0.7500 | 0 |
| legacy | horizon | PERSON | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | EMAIL_ADDRESS | 38 | 4 | 34 | 4 | 1 | 0 | 33 | 1.0000 | 0.8000 | 0.9737 | 0.9853 | 0 |
| legacy | horizon | PHONE_NUMBER | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | IT_FISCAL_CODE | 38 | 7 | 31 | 6 | 0 | 1 | 31 | 0.8571 | 1.0000 | 0.9737 | 0.9286 | 0 |
| legacy | horizon | IT_VAT_CODE | 38 | 7 | 31 | 6 | 0 | 1 | 31 | 0.8571 | 1.0000 | 0.9737 | 0.9286 | 0 |
| legacy | horizon | IBAN_CODE | 38 | 4 | 34 | 3 | 0 | 1 | 34 | 0.7500 | 1.0000 | 0.9737 | 0.8750 | 0 |
| legacy | horizon | CREDIT_CARD | 38 | 3 | 35 | 2 | 0 | 1 | 35 | 0.6667 | 1.0000 | 0.9737 | 0.8333 | 0 |
| legacy | horizon | IT_IDENTITY_CARD | 38 | 5 | 33 | 2 | 0 | 3 | 33 | 0.4000 | 1.0000 | 0.9211 | 0.7000 | 0 |
| legacy | horizon | IT_DRIVER_LICENSE | 38 | 6 | 32 | 2 | 0 | 4 | 32 | 0.3333 | 1.0000 | 0.8947 | 0.6667 | 0 |
| legacy | presidio | PERSON | 38 | 4 | 34 | 4 | 8 | 0 | 26 | 1.0000 | 0.3333 | 0.7895 | 0.8824 | 0 |
| legacy | presidio | EMAIL_ADDRESS | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | presidio | PHONE_NUMBER | 38 | 7 | 31 | 6 | 0 | 1 | 31 | 0.8571 | 1.0000 | 0.9737 | 0.9286 | 0 |
| legacy | presidio | IT_FISCAL_CODE | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | presidio | IT_VAT_CODE | 38 | 7 | 31 | 6 | 0 | 1 | 31 | 0.8571 | 1.0000 | 0.9737 | 0.9286 | 0 |
| legacy | presidio | IBAN_CODE | 38 | 4 | 34 | 3 | 0 | 1 | 34 | 0.7500 | 1.0000 | 0.9737 | 0.8750 | 0 |
| legacy | presidio | CREDIT_CARD | 38 | 3 | 35 | 1 | 0 | 2 | 35 | 0.3333 | 1.0000 | 0.9474 | 0.6667 | 0 |
| legacy | presidio | IT_IDENTITY_CARD | 38 | 5 | 33 | 5 | 0 | 0 | 33 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | presidio | IT_DRIVER_LICENSE | 38 | 6 | 32 | 2 | 0 | 4 | 32 | 0.3333 | 1.0000 | 0.8947 | 0.6667 | 0 |
| rizzo | rizzo | PERSON | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0 |
| rizzo | rizzo | EMAIL_ADDRESS | 10 | 7 | 3 | 7 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | rizzo | PHONE_NUMBER | 10 | 8 | 2 | 8 | 0 | 0 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | rizzo | IT_FISCAL_CODE | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | rizzo | IT_VAT_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 1.0000 | N/A | 0 |
| rizzo | rizzo | IBAN_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 1.0000 | N/A | 0 |
| rizzo | rizzo | CREDIT_CARD | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | rizzo | IT_IDENTITY_CARD | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| rizzo | rizzo | IT_DRIVER_LICENSE | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| rizzo | horizon | PERSON | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0 |
| rizzo | horizon | EMAIL_ADDRESS | 10 | 7 | 3 | 7 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | horizon | PHONE_NUMBER | 10 | 8 | 2 | 8 | 0 | 0 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | horizon | IT_FISCAL_CODE | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | horizon | IT_VAT_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 1.0000 | N/A | 0 |
| rizzo | horizon | IBAN_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 1.0000 | N/A | 0 |
| rizzo | horizon | CREDIT_CARD | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | horizon | IT_IDENTITY_CARD | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| rizzo | horizon | IT_DRIVER_LICENSE | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| rizzo | presidio | PERSON | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0 |
| rizzo | presidio | EMAIL_ADDRESS | 10 | 7 | 3 | 7 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | presidio | PHONE_NUMBER | 10 | 8 | 2 | 8 | 0 | 0 | 2 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | presidio | IT_FISCAL_CODE | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | presidio | IT_VAT_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 1.0000 | N/A | 0 |
| rizzo | presidio | IBAN_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 1.0000 | N/A | 0 |
| rizzo | presidio | CREDIT_CARD | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| rizzo | presidio | IT_IDENTITY_CARD | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| rizzo | presidio | IT_DRIVER_LICENSE | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| targeted | rizzo | PERSON | 26 | 5 | 21 | 5 | 0 | 0 | 21 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | PHONE_NUMBER | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IT_VAT_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IBAN_CODE | 26 | 3 | 23 | 3 | 1 | 0 | 22 | 1.0000 | 0.7500 | 0.9615 | 0.9783 | 0 |
| targeted | rizzo | CREDIT_CARD | 26 | 3 | 23 | 3 | 0 | 0 | 23 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IT_IDENTITY_CARD | 26 | 1 | 25 | 0 | 0 | 1 | 25 | 0.0000 | N/A | 0.9615 | 0.5000 | 0 |
| targeted | rizzo | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | PERSON | 26 | 5 | 21 | 5 | 0 | 0 | 21 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | PHONE_NUMBER | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | IT_FISCAL_CODE | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | horizon | IT_VAT_CODE | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | horizon | IBAN_CODE | 26 | 3 | 23 | 1 | 0 | 2 | 23 | 0.3333 | 1.0000 | 0.9231 | 0.6667 | 0 |
| targeted | horizon | CREDIT_CARD | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0.9615 | 0.8333 | 0 |
| targeted | horizon | IT_IDENTITY_CARD | 26 | 1 | 25 | 0 | 0 | 1 | 25 | 0.0000 | N/A | 0.9615 | 0.5000 | 0 |
| targeted | horizon | IT_DRIVER_LICENSE | 26 | 1 | 25 | 0 | 0 | 1 | 25 | 0.0000 | N/A | 0.9615 | 0.5000 | 0 |
| targeted | presidio | PERSON | 26 | 5 | 21 | 3 | 0 | 2 | 21 | 0.6000 | 1.0000 | 0.9231 | 0.8000 | 0 |
| targeted | presidio | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | PHONE_NUMBER | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | presidio | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | IT_VAT_CODE | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | presidio | IBAN_CODE | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0.9615 | 0.8333 | 0 |
| targeted | presidio | CREDIT_CARD | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0.9615 | 0.8333 | 0 |
| targeted | presidio | IT_IDENTITY_CARD | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | rizzo | PERSON | 92 | 32 | 60 | 32 | 0 | 0 | 60 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | rizzo | EMAIL_ADDRESS | 92 | 16 | 76 | 16 | 0 | 0 | 76 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | rizzo | PHONE_NUMBER | 92 | 17 | 75 | 12 | 1 | 5 | 74 | 0.7059 | 0.9231 | 0.9348 | 0.8463 | 0 |
| ALL | rizzo | IT_FISCAL_CODE | 92 | 15 | 77 | 15 | 0 | 0 | 77 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | rizzo | IT_VAT_CODE | 92 | 9 | 83 | 4 | 4 | 5 | 79 | 0.4444 | 0.5000 | 0.9022 | 0.6981 | 0 |
| ALL | rizzo | IBAN_CODE | 92 | 8 | 84 | 8 | 5 | 0 | 79 | 1.0000 | 0.6154 | 0.9457 | 0.9702 | 0 |
| ALL | rizzo | CREDIT_CARD | 92 | 13 | 79 | 13 | 0 | 0 | 79 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | rizzo | IT_IDENTITY_CARD | 86 | 7 | 79 | 6 | 0 | 1 | 79 | 0.8571 | 1.0000 | 0.9884 | 0.9286 | 6 |
| ALL | rizzo | IT_DRIVER_LICENSE | 85 | 8 | 77 | 5 | 0 | 3 | 77 | 0.6250 | 1.0000 | 0.9647 | 0.8125 | 7 |
| ALL | horizon | PERSON | 92 | 32 | 60 | 32 | 0 | 0 | 60 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | horizon | EMAIL_ADDRESS | 92 | 16 | 76 | 16 | 1 | 0 | 75 | 1.0000 | 0.9412 | 0.9891 | 0.9934 | 0 |
| ALL | horizon | PHONE_NUMBER | 92 | 17 | 75 | 17 | 2 | 0 | 73 | 1.0000 | 0.8947 | 0.9783 | 0.9867 | 0 |
| ALL | horizon | IT_FISCAL_CODE | 92 | 15 | 77 | 13 | 0 | 2 | 77 | 0.8667 | 1.0000 | 0.9783 | 0.9333 | 0 |
| ALL | horizon | IT_VAT_CODE | 92 | 9 | 83 | 7 | 0 | 2 | 83 | 0.7778 | 1.0000 | 0.9783 | 0.8889 | 0 |
| ALL | horizon | IBAN_CODE | 92 | 8 | 84 | 4 | 0 | 4 | 84 | 0.5000 | 1.0000 | 0.9565 | 0.7500 | 0 |
| ALL | horizon | CREDIT_CARD | 92 | 13 | 79 | 11 | 0 | 2 | 79 | 0.8462 | 1.0000 | 0.9783 | 0.9231 | 0 |
| ALL | horizon | IT_IDENTITY_CARD | 86 | 7 | 79 | 3 | 0 | 4 | 79 | 0.4286 | 1.0000 | 0.9535 | 0.7143 | 6 |
| ALL | horizon | IT_DRIVER_LICENSE | 85 | 8 | 77 | 3 | 0 | 5 | 77 | 0.3750 | 1.0000 | 0.9412 | 0.6875 | 7 |
| ALL | presidio | PERSON | 92 | 32 | 60 | 25 | 11 | 7 | 49 | 0.7812 | 0.6944 | 0.8043 | 0.7990 | 0 |
| ALL | presidio | EMAIL_ADDRESS | 92 | 16 | 76 | 16 | 0 | 0 | 76 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | presidio | PHONE_NUMBER | 92 | 17 | 75 | 15 | 1 | 2 | 74 | 0.8824 | 0.9375 | 0.9674 | 0.9345 | 0 |
| ALL | presidio | IT_FISCAL_CODE | 92 | 15 | 77 | 15 | 0 | 0 | 77 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | presidio | IT_VAT_CODE | 92 | 9 | 83 | 7 | 0 | 2 | 83 | 0.7778 | 1.0000 | 0.9783 | 0.8889 | 0 |
| ALL | presidio | IBAN_CODE | 92 | 8 | 84 | 6 | 0 | 2 | 84 | 0.7500 | 1.0000 | 0.9783 | 0.8750 | 0 |
| ALL | presidio | CREDIT_CARD | 92 | 13 | 79 | 9 | 0 | 4 | 79 | 0.6923 | 1.0000 | 0.9565 | 0.8462 | 0 |
| ALL | presidio | IT_IDENTITY_CARD | 86 | 7 | 79 | 7 | 0 | 0 | 79 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| ALL | presidio | IT_DRIVER_LICENSE | 85 | 8 | 77 | 4 | 0 | 4 | 77 | 0.5000 | 1.0000 | 0.9529 | 0.7500 | 7 |

## Observed HTTP verdict (positive = rejected)

| source | engine | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | falseAcceptanceRate | falseRejectionRate | unknownExcluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gretel | rizzo | 18 | 13 | 5 | 13 | 2 | 0 | 3 | 1.0000 | 0.8667 | 0.8889 | 0.8000 | 0.0000 | 0.4000 | 0 |
| gretel | horizon | 18 | 13 | 5 | 13 | 0 | 0 | 5 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0.0000 | 0.0000 | 0 |
| gretel | presidio | 18 | 13 | 5 | 8 | 3 | 5 | 2 | 0.6154 | 0.7273 | 0.5556 | 0.5077 | 0.3846 | 0.6000 | 0 |
| legacy | rizzo | 38 | 25 | 13 | 21 | 1 | 4 | 12 | 0.8400 | 0.9545 | 0.8684 | 0.8815 | 0.1600 | 0.0769 | 0 |
| legacy | horizon | 38 | 25 | 13 | 20 | 1 | 5 | 12 | 0.8000 | 0.9524 | 0.8421 | 0.8615 | 0.2000 | 0.0769 | 0 |
| legacy | presidio | 38 | 25 | 13 | 20 | 2 | 5 | 11 | 0.8000 | 0.9091 | 0.8158 | 0.8231 | 0.2000 | 0.1538 | 0 |
| rizzo | rizzo | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| rizzo | horizon | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| rizzo | presidio | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| targeted | rizzo | 25 | 18 | 7 | 17 | 0 | 1 | 7 | 0.9444 | 1.0000 | 0.9600 | 0.9722 | 0.0556 | 0.0000 | 0 |
| targeted | horizon | 25 | 18 | 7 | 11 | 0 | 7 | 7 | 0.6111 | 1.0000 | 0.7200 | 0.8056 | 0.3889 | 0.0000 | 0 |
| targeted | presidio | 25 | 18 | 7 | 13 | 0 | 5 | 7 | 0.7222 | 1.0000 | 0.8000 | 0.8611 | 0.2778 | 0.0000 | 0 |
| ALL | rizzo | 91 | 66 | 25 | 61 | 3 | 5 | 22 | 0.9242 | 0.9531 | 0.9121 | 0.9021 | 0.0758 | 0.1200 | 0 |
| ALL | horizon | 91 | 66 | 25 | 54 | 1 | 12 | 24 | 0.8182 | 0.9818 | 0.8571 | 0.8891 | 0.1818 | 0.0400 | 0 |
| ALL | presidio | 91 | 66 | 25 | 51 | 5 | 15 | 20 | 0.7727 | 0.9107 | 0.7802 | 0.7864 | 0.2273 | 0.2000 | 0 |

## Limitations

Non-heldout development pilot: original inputs were already evaluated; legacy families and policy variants are correlated. Repeated policy scenarios also repeat detection probes and weight the case/field matrices. Distinct texts and family counts are not independent sample sizes. No production representativeness, unseen-training claim, performance measurement or detector-quality gate. Accepted is not proof of absence of personal data. This bundle validates structure and internal consistency, not authenticity against coordinated edits.
