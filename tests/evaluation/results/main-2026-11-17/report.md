# Uniform three-engine pilot

Complete: True

Detection: deny-all POST; category presence per case/field, not spans or entity counts. Policy: separate HTTP POST with field allowlists. Same closed nine-category API for all engines. No inferred or normalized verdicts. Matrices use successful requests paired across ALL THREE engines, separately per probe. Unknown pairs are excluded, never TN; zero denominators are N/A.

## Source inventory

| source | cases | fields | distinctTexts | families | unknownPairs |
| --- | --- | --- | --- | --- | --- |
| aliasit | 30 | 30 | 30 | 29 | 0 |
| gretel | 48 | 48 | 48 | 12 | 1 |
| legacy | 38 | 38 | 28 | 21 | 0 |
| rizzo | 10 | 10 | 10 | 2 | 12 |
| targeted | 25 | 26 | 26 | 21 | 0 |
| ALL | 151 | 152 | 142 | 85 | 13 |

## Coverage (own successes; failures never scored)

| source | engine | probe | planned | attempted | success | technical_failure | contract_failure | unattempted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aliasit | rizzo | detection | 30 | 30 | 30 | 0 | 0 | 0 |
| aliasit | horizon | detection | 30 | 30 | 30 | 0 | 0 | 0 |
| aliasit | presidio | detection | 30 | 30 | 30 | 0 | 0 | 0 |
| aliasit | rizzo | policy | 30 | 30 | 30 | 0 | 0 | 0 |
| aliasit | horizon | policy | 30 | 30 | 30 | 0 | 0 | 0 |
| aliasit | presidio | policy | 30 | 30 | 30 | 0 | 0 | 0 |
| gretel | rizzo | detection | 48 | 48 | 48 | 0 | 0 | 0 |
| gretel | horizon | detection | 48 | 48 | 48 | 0 | 0 | 0 |
| gretel | presidio | detection | 48 | 48 | 48 | 0 | 0 | 0 |
| gretel | rizzo | policy | 48 | 48 | 48 | 0 | 0 | 0 |
| gretel | horizon | policy | 48 | 48 | 48 | 0 | 0 | 0 |
| gretel | presidio | policy | 48 | 48 | 48 | 0 | 0 | 0 |
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
| ALL | rizzo | detection | 151 | 151 | 151 | 0 | 0 | 0 |
| ALL | horizon | detection | 151 | 151 | 151 | 0 | 0 | 0 |
| ALL | presidio | detection | 151 | 151 | 151 | 0 | 0 | 0 |
| ALL | rizzo | policy | 151 | 151 | 151 | 0 | 0 | 0 |
| ALL | horizon | policy | 151 | 151 | 151 | 0 | 0 | 0 |
| ALL | presidio | policy | 151 | 151 | 151 | 0 | 0 | 0 |

## Paired successes

| source | detection | policy |
| --- | --- | --- |
| aliasit | 30 | 30 |
| gretel | 48 | 48 |
| legacy | 38 | 38 |
| rizzo | 10 | 10 |
| targeted | 25 | 25 |
| ALL | 151 | 151 |

## Detection

| source | engine | category | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | unknownExcluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aliasit | rizzo | PERSON | 30 | 11 | 19 | 11 | 0 | 0 | 19 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | rizzo | EMAIL_ADDRESS | 30 | 6 | 24 | 6 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | rizzo | PHONE_NUMBER | 30 | 2 | 28 | 2 | 4 | 0 | 24 | 1.0000 | 0.3333 | 0.8667 | 0.9286 | 0 |
| aliasit | rizzo | IT_FISCAL_CODE | 30 | 2 | 28 | 2 | 0 | 0 | 28 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | rizzo | IT_VAT_CODE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | rizzo | IBAN_CODE | 30 | 0 | 30 | 0 | 3 | 0 | 27 | N/A | 0.0000 | 0.9000 | N/A | 0 |
| aliasit | rizzo | CREDIT_CARD | 30 | 1 | 29 | 1 | 0 | 0 | 29 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | rizzo | IT_IDENTITY_CARD | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | rizzo | IT_DRIVER_LICENSE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | horizon | PERSON | 30 | 11 | 19 | 10 | 0 | 1 | 19 | 0.9091 | 1.0000 | 0.9667 | 0.9545 | 0 |
| aliasit | horizon | EMAIL_ADDRESS | 30 | 6 | 24 | 6 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | horizon | PHONE_NUMBER | 30 | 2 | 28 | 2 | 4 | 0 | 24 | 1.0000 | 0.3333 | 0.8667 | 0.9286 | 0 |
| aliasit | horizon | IT_FISCAL_CODE | 30 | 2 | 28 | 2 | 0 | 0 | 28 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | horizon | IT_VAT_CODE | 30 | 0 | 30 | 0 | 1 | 0 | 29 | N/A | 0.0000 | 0.9667 | N/A | 0 |
| aliasit | horizon | IBAN_CODE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | horizon | CREDIT_CARD | 30 | 1 | 29 | 1 | 3 | 0 | 26 | 1.0000 | 0.2500 | 0.9000 | 0.9483 | 0 |
| aliasit | horizon | IT_IDENTITY_CARD | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | horizon | IT_DRIVER_LICENSE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | presidio | PERSON | 30 | 11 | 19 | 5 | 1 | 6 | 18 | 0.4545 | 0.8333 | 0.7667 | 0.7010 | 0 |
| aliasit | presidio | EMAIL_ADDRESS | 30 | 6 | 24 | 6 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | presidio | PHONE_NUMBER | 30 | 2 | 28 | 2 | 1 | 0 | 27 | 1.0000 | 0.6667 | 0.9667 | 0.9821 | 0 |
| aliasit | presidio | IT_FISCAL_CODE | 30 | 2 | 28 | 2 | 0 | 0 | 28 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| aliasit | presidio | IT_VAT_CODE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | presidio | IBAN_CODE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | presidio | CREDIT_CARD | 30 | 1 | 29 | 0 | 0 | 1 | 29 | 0.0000 | N/A | 0.9667 | 0.5000 | 0 |
| aliasit | presidio | IT_IDENTITY_CARD | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| aliasit | presidio | IT_DRIVER_LICENSE | 30 | 0 | 30 | 0 | 0 | 0 | 30 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | rizzo | PERSON | 48 | 33 | 15 | 31 | 2 | 2 | 13 | 0.9394 | 0.9394 | 0.9167 | 0.9030 | 0 |
| gretel | rizzo | EMAIL_ADDRESS | 48 | 3 | 45 | 3 | 1 | 0 | 44 | 1.0000 | 0.7500 | 0.9792 | 0.9889 | 0 |
| gretel | rizzo | PHONE_NUMBER | 48 | 1 | 47 | 0 | 0 | 1 | 47 | 0.0000 | N/A | 0.9792 | 0.5000 | 0 |
| gretel | rizzo | IT_FISCAL_CODE | 48 | 0 | 48 | 0 | 3 | 0 | 45 | N/A | 0.0000 | 0.9375 | N/A | 0 |
| gretel | rizzo | IT_VAT_CODE | 48 | 1 | 47 | 0 | 5 | 1 | 42 | 0.0000 | 0.0000 | 0.8750 | 0.4468 | 0 |
| gretel | rizzo | IBAN_CODE | 48 | 2 | 46 | 2 | 14 | 0 | 32 | 1.0000 | 0.1250 | 0.7083 | 0.8478 | 0 |
| gretel | rizzo | CREDIT_CARD | 48 | 1 | 47 | 1 | 5 | 0 | 42 | 1.0000 | 0.1667 | 0.8958 | 0.9468 | 0 |
| gretel | rizzo | IT_IDENTITY_CARD | 48 | 0 | 48 | 0 | 0 | 0 | 48 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | rizzo | IT_DRIVER_LICENSE | 47 | 0 | 47 | 0 | 0 | 0 | 47 | N/A | N/A | 1.0000 | N/A | 1 |
| gretel | horizon | PERSON | 48 | 33 | 15 | 32 | 1 | 1 | 14 | 0.9697 | 0.9697 | 0.9583 | 0.9515 | 0 |
| gretel | horizon | EMAIL_ADDRESS | 48 | 3 | 45 | 3 | 0 | 0 | 45 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | horizon | PHONE_NUMBER | 48 | 1 | 47 | 1 | 1 | 0 | 46 | 1.0000 | 0.5000 | 0.9792 | 0.9894 | 0 |
| gretel | horizon | IT_FISCAL_CODE | 48 | 0 | 48 | 0 | 0 | 0 | 48 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | horizon | IT_VAT_CODE | 48 | 1 | 47 | 1 | 0 | 0 | 47 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | horizon | IBAN_CODE | 48 | 2 | 46 | 2 | 1 | 0 | 45 | 1.0000 | 0.6667 | 0.9792 | 0.9891 | 0 |
| gretel | horizon | CREDIT_CARD | 48 | 1 | 47 | 1 | 4 | 0 | 43 | 1.0000 | 0.2000 | 0.9167 | 0.9574 | 0 |
| gretel | horizon | IT_IDENTITY_CARD | 48 | 0 | 48 | 0 | 0 | 0 | 48 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | horizon | IT_DRIVER_LICENSE | 47 | 0 | 47 | 0 | 0 | 0 | 47 | N/A | N/A | 1.0000 | N/A | 1 |
| gretel | presidio | PERSON | 48 | 33 | 15 | 26 | 9 | 7 | 6 | 0.7879 | 0.7429 | 0.6667 | 0.5939 | 0 |
| gretel | presidio | EMAIL_ADDRESS | 48 | 3 | 45 | 3 | 0 | 0 | 45 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| gretel | presidio | PHONE_NUMBER | 48 | 1 | 47 | 0 | 2 | 1 | 45 | 0.0000 | 0.0000 | 0.9375 | 0.4787 | 0 |
| gretel | presidio | IT_FISCAL_CODE | 48 | 0 | 48 | 0 | 0 | 0 | 48 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | presidio | IT_VAT_CODE | 48 | 1 | 47 | 0 | 1 | 1 | 46 | 0.0000 | 0.0000 | 0.9583 | 0.4894 | 0 |
| gretel | presidio | IBAN_CODE | 48 | 2 | 46 | 1 | 0 | 1 | 46 | 0.5000 | 1.0000 | 0.9792 | 0.7500 | 0 |
| gretel | presidio | CREDIT_CARD | 48 | 1 | 47 | 0 | 0 | 1 | 47 | 0.0000 | N/A | 0.9792 | 0.5000 | 0 |
| gretel | presidio | IT_IDENTITY_CARD | 48 | 0 | 48 | 0 | 0 | 0 | 48 | N/A | N/A | 1.0000 | N/A | 0 |
| gretel | presidio | IT_DRIVER_LICENSE | 47 | 0 | 47 | 0 | 0 | 0 | 47 | N/A | N/A | 1.0000 | N/A | 1 |
| legacy | rizzo | PERSON | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | EMAIL_ADDRESS | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | PHONE_NUMBER | 38 | 7 | 31 | 5 | 0 | 2 | 31 | 0.7143 | 1.0000 | 0.9474 | 0.8571 | 0 |
| legacy | rizzo | IT_FISCAL_CODE | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | IT_VAT_CODE | 38 | 7 | 31 | 2 | 0 | 5 | 31 | 0.2857 | 1.0000 | 0.8684 | 0.6429 | 0 |
| legacy | rizzo | IBAN_CODE | 38 | 4 | 34 | 4 | 2 | 0 | 32 | 1.0000 | 0.6667 | 0.9474 | 0.9706 | 0 |
| legacy | rizzo | CREDIT_CARD | 38 | 3 | 35 | 3 | 0 | 0 | 35 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | IT_IDENTITY_CARD | 38 | 5 | 33 | 5 | 0 | 0 | 33 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | rizzo | IT_DRIVER_LICENSE | 38 | 6 | 32 | 3 | 0 | 3 | 32 | 0.5000 | 1.0000 | 0.9211 | 0.7500 | 0 |
| legacy | horizon | PERSON | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | EMAIL_ADDRESS | 38 | 4 | 34 | 4 | 1 | 0 | 33 | 1.0000 | 0.8000 | 0.9737 | 0.9853 | 0 |
| legacy | horizon | PHONE_NUMBER | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | IT_FISCAL_CODE | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | IT_VAT_CODE | 38 | 7 | 31 | 7 | 0 | 0 | 31 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | IBAN_CODE | 38 | 4 | 34 | 4 | 0 | 0 | 34 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | CREDIT_CARD | 38 | 3 | 35 | 3 | 0 | 0 | 35 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | IT_IDENTITY_CARD | 38 | 5 | 33 | 5 | 0 | 0 | 33 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| legacy | horizon | IT_DRIVER_LICENSE | 38 | 6 | 32 | 3 | 0 | 3 | 32 | 0.5000 | 1.0000 | 0.9211 | 0.7500 | 0 |
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
| targeted | rizzo | PHONE_NUMBER | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | rizzo | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IT_VAT_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IBAN_CODE | 26 | 3 | 23 | 3 | 1 | 0 | 22 | 1.0000 | 0.7500 | 0.9615 | 0.9783 | 0 |
| targeted | rizzo | CREDIT_CARD | 26 | 3 | 23 | 3 | 0 | 0 | 23 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | rizzo | IT_IDENTITY_CARD | 26 | 1 | 25 | 0 | 0 | 1 | 25 | 0.0000 | N/A | 0.9615 | 0.5000 | 0 |
| targeted | rizzo | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | PERSON | 26 | 5 | 21 | 5 | 0 | 0 | 21 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | PHONE_NUMBER | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | IT_VAT_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | IBAN_CODE | 26 | 3 | 23 | 3 | 0 | 0 | 23 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | horizon | CREDIT_CARD | 26 | 3 | 23 | 3 | 1 | 0 | 22 | 1.0000 | 0.7500 | 0.9615 | 0.9783 | 0 |
| targeted | horizon | IT_IDENTITY_CARD | 26 | 1 | 25 | 0 | 0 | 1 | 25 | 0.0000 | N/A | 0.9615 | 0.5000 | 0 |
| targeted | horizon | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | PERSON | 26 | 5 | 21 | 3 | 0 | 2 | 21 | 0.6000 | 1.0000 | 0.9231 | 0.8000 | 0 |
| targeted | presidio | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | PHONE_NUMBER | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | presidio | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | IT_VAT_CODE | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0.9615 | 0.7500 | 0 |
| targeted | presidio | IBAN_CODE | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0.9615 | 0.8333 | 0 |
| targeted | presidio | CREDIT_CARD | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0.9615 | 0.8333 | 0 |
| targeted | presidio | IT_IDENTITY_CARD | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| targeted | presidio | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | rizzo | PERSON | 152 | 63 | 89 | 61 | 2 | 2 | 87 | 0.9683 | 0.9683 | 0.9737 | 0.9729 | 0 |
| ALL | rizzo | EMAIL_ADDRESS | 152 | 24 | 128 | 24 | 1 | 0 | 127 | 1.0000 | 0.9600 | 0.9934 | 0.9961 | 0 |
| ALL | rizzo | PHONE_NUMBER | 152 | 20 | 132 | 16 | 4 | 4 | 128 | 0.8000 | 0.8000 | 0.9474 | 0.8848 | 0 |
| ALL | rizzo | IT_FISCAL_CODE | 152 | 17 | 135 | 17 | 3 | 0 | 132 | 1.0000 | 0.8500 | 0.9803 | 0.9889 | 0 |
| ALL | rizzo | IT_VAT_CODE | 152 | 10 | 142 | 4 | 5 | 6 | 137 | 0.4000 | 0.4444 | 0.9276 | 0.6824 | 0 |
| ALL | rizzo | IBAN_CODE | 152 | 9 | 143 | 9 | 20 | 0 | 123 | 1.0000 | 0.3103 | 0.8684 | 0.9301 | 0 |
| ALL | rizzo | CREDIT_CARD | 152 | 14 | 138 | 14 | 5 | 0 | 133 | 1.0000 | 0.7368 | 0.9671 | 0.9819 | 0 |
| ALL | rizzo | IT_IDENTITY_CARD | 146 | 7 | 139 | 6 | 0 | 1 | 139 | 0.8571 | 1.0000 | 0.9932 | 0.9286 | 6 |
| ALL | rizzo | IT_DRIVER_LICENSE | 145 | 8 | 137 | 5 | 0 | 3 | 137 | 0.6250 | 1.0000 | 0.9793 | 0.8125 | 7 |
| ALL | horizon | PERSON | 152 | 63 | 89 | 61 | 1 | 2 | 88 | 0.9683 | 0.9839 | 0.9803 | 0.9785 | 0 |
| ALL | horizon | EMAIL_ADDRESS | 152 | 24 | 128 | 24 | 1 | 0 | 127 | 1.0000 | 0.9600 | 0.9934 | 0.9961 | 0 |
| ALL | horizon | PHONE_NUMBER | 152 | 20 | 132 | 20 | 5 | 0 | 127 | 1.0000 | 0.8000 | 0.9671 | 0.9811 | 0 |
| ALL | horizon | IT_FISCAL_CODE | 152 | 17 | 135 | 17 | 0 | 0 | 135 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | horizon | IT_VAT_CODE | 152 | 10 | 142 | 10 | 1 | 0 | 141 | 1.0000 | 0.9091 | 0.9934 | 0.9965 | 0 |
| ALL | horizon | IBAN_CODE | 152 | 9 | 143 | 9 | 1 | 0 | 142 | 1.0000 | 0.9000 | 0.9934 | 0.9965 | 0 |
| ALL | horizon | CREDIT_CARD | 152 | 14 | 138 | 14 | 8 | 0 | 130 | 1.0000 | 0.6364 | 0.9474 | 0.9710 | 0 |
| ALL | horizon | IT_IDENTITY_CARD | 146 | 7 | 139 | 6 | 0 | 1 | 139 | 0.8571 | 1.0000 | 0.9932 | 0.9286 | 6 |
| ALL | horizon | IT_DRIVER_LICENSE | 145 | 8 | 137 | 5 | 0 | 3 | 137 | 0.6250 | 1.0000 | 0.9793 | 0.8125 | 7 |
| ALL | presidio | PERSON | 152 | 63 | 89 | 48 | 18 | 15 | 71 | 0.7619 | 0.7273 | 0.7829 | 0.7798 | 0 |
| ALL | presidio | EMAIL_ADDRESS | 152 | 24 | 128 | 24 | 0 | 0 | 128 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | presidio | PHONE_NUMBER | 152 | 20 | 132 | 17 | 3 | 3 | 129 | 0.8500 | 0.8500 | 0.9605 | 0.9136 | 0 |
| ALL | presidio | IT_FISCAL_CODE | 152 | 17 | 135 | 17 | 0 | 0 | 135 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 0 |
| ALL | presidio | IT_VAT_CODE | 152 | 10 | 142 | 7 | 1 | 3 | 141 | 0.7000 | 0.8750 | 0.9737 | 0.8465 | 0 |
| ALL | presidio | IBAN_CODE | 152 | 9 | 143 | 6 | 0 | 3 | 143 | 0.6667 | 1.0000 | 0.9803 | 0.8333 | 0 |
| ALL | presidio | CREDIT_CARD | 152 | 14 | 138 | 9 | 0 | 5 | 138 | 0.6429 | 1.0000 | 0.9671 | 0.8214 | 0 |
| ALL | presidio | IT_IDENTITY_CARD | 146 | 7 | 139 | 7 | 0 | 0 | 139 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 6 |
| ALL | presidio | IT_DRIVER_LICENSE | 145 | 8 | 137 | 4 | 0 | 4 | 137 | 0.5000 | 1.0000 | 0.9724 | 0.7500 | 7 |

## Observed HTTP verdict (positive = rejected)

| source | engine | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | falseAcceptanceRate | falseRejectionRate | unknownExcluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| aliasit | rizzo | 30 | 12 | 18 | 12 | 4 | 0 | 14 | 1.0000 | 0.7500 | 0.8667 | 0.8889 | 0.0000 | 0.2222 | 0 |
| aliasit | horizon | 30 | 12 | 18 | 12 | 5 | 0 | 13 | 1.0000 | 0.7059 | 0.8333 | 0.8611 | 0.0000 | 0.2778 | 0 |
| aliasit | presidio | 30 | 12 | 18 | 8 | 2 | 4 | 16 | 0.6667 | 0.8000 | 0.8000 | 0.7778 | 0.3333 | 0.1111 | 0 |
| gretel | rizzo | 48 | 33 | 15 | 32 | 7 | 1 | 8 | 0.9697 | 0.8205 | 0.8333 | 0.7515 | 0.0303 | 0.4667 | 0 |
| gretel | horizon | 48 | 33 | 15 | 33 | 1 | 0 | 14 | 1.0000 | 0.9706 | 0.9792 | 0.9667 | 0.0000 | 0.0667 | 0 |
| gretel | presidio | 48 | 33 | 15 | 27 | 8 | 6 | 7 | 0.8182 | 0.7714 | 0.7083 | 0.6424 | 0.1818 | 0.5333 | 0 |
| legacy | rizzo | 38 | 25 | 13 | 23 | 1 | 2 | 12 | 0.9200 | 0.9583 | 0.9211 | 0.9215 | 0.0800 | 0.0769 | 0 |
| legacy | horizon | 38 | 25 | 13 | 25 | 1 | 0 | 12 | 1.0000 | 0.9615 | 0.9737 | 0.9615 | 0.0000 | 0.0769 | 0 |
| legacy | presidio | 38 | 25 | 13 | 20 | 2 | 5 | 11 | 0.8000 | 0.9091 | 0.8158 | 0.8231 | 0.2000 | 0.1538 | 0 |
| rizzo | rizzo | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| rizzo | horizon | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| rizzo | presidio | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| targeted | rizzo | 25 | 18 | 7 | 17 | 0 | 1 | 7 | 0.9444 | 1.0000 | 0.9600 | 0.9722 | 0.0556 | 0.0000 | 0 |
| targeted | horizon | 25 | 18 | 7 | 17 | 0 | 1 | 7 | 0.9444 | 1.0000 | 0.9600 | 0.9722 | 0.0556 | 0.0000 | 0 |
| targeted | presidio | 25 | 18 | 7 | 13 | 0 | 5 | 7 | 0.7222 | 1.0000 | 0.8000 | 0.8611 | 0.2778 | 0.0000 | 0 |
| ALL | rizzo | 151 | 98 | 53 | 94 | 12 | 4 | 41 | 0.9592 | 0.8868 | 0.8940 | 0.8664 | 0.0408 | 0.2264 | 0 |
| ALL | horizon | 151 | 98 | 53 | 97 | 7 | 1 | 46 | 0.9898 | 0.9327 | 0.9470 | 0.9289 | 0.0102 | 0.1321 | 0 |
| ALL | presidio | 151 | 98 | 53 | 78 | 12 | 20 | 41 | 0.7959 | 0.8667 | 0.7881 | 0.7848 | 0.2041 | 0.2264 | 0 |

## Limitations

Non-heldout development pilot: original inputs were already evaluated; legacy families and policy variants are correlated. Repeated policy scenarios also repeat detection probes and weight the case/field matrices. Distinct texts and family counts are not independent sample sizes. No production representativeness, unseen-training claim, performance measurement or detector-quality gate. Accepted is not proof of absence of personal data. This bundle validates structure and internal consistency, not authenticity against coordinated edits.
