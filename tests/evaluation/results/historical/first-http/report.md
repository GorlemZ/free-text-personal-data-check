# External pilot

Complete: True

## Protocol

Detection: deny-all requests; category presence per field, not spans or entity counts. Policy: separate real requests with field allowlists. Paired successes are selected separately for each probe. Unknown field/category labels are excluded, never counted as TN. Zero denominators are N/A.

## Baseline registry evidence

Evidence: parent-provided-runtime; modelPolicyVersion: it-spacy-sm-3.8.0-poc1.
Unavailable scored categories (not sent in baseline allowlists): none.
Registry support does not prove effective detection. The baseline service/configuration is not modified by this runner.

## Coverage

| source | engine | probe | planned | attempted | success | technical_failure | contract_failure | unattempted |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gretel | new | detection | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | baseline | detection | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | new | policy | 18 | 18 | 18 | 0 | 0 | 0 |
| gretel | baseline | policy | 18 | 18 | 18 | 0 | 0 | 0 |
| rizzo | new | detection | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | baseline | detection | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | new | policy | 10 | 10 | 10 | 0 | 0 | 0 |
| rizzo | baseline | policy | 10 | 10 | 10 | 0 | 0 | 0 |
| targeted | new | detection | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | baseline | detection | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | new | policy | 25 | 25 | 25 | 0 | 0 | 0 |
| targeted | baseline | policy | 25 | 25 | 25 | 0 | 0 | 0 |
| ALL | new | detection | 53 | 53 | 53 | 0 | 0 | 0 |
| ALL | baseline | detection | 53 | 53 | 53 | 0 | 0 | 0 |
| ALL | new | policy | 53 | 53 | 53 | 0 | 0 | 0 |
| ALL | baseline | policy | 53 | 53 | 53 | 0 | 0 | 0 |

## Detection (paired successful requests)

| source | engine | category | n | positive | negative | tp | fp | fn | tn | recall | precision | unknownExcluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gretel | new | PERSON | 18 | 13 | 5 | 13 | 0 | 0 | 5 | 1.0000 | 1.0000 | 0 |
| gretel | new | EMAIL_ADDRESS | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 0 |
| gretel | new | PHONE_NUMBER | 18 | 0 | 18 | 0 | 1 | 0 | 17 | N/A | 0.0000 | 0 |
| gretel | new | IT_FISCAL_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 0 |
| gretel | new | IT_VAT_CODE | 18 | 0 | 18 | 0 | 4 | 0 | 14 | N/A | 0.0000 | 0 |
| gretel | new | IBAN_CODE | 18 | 1 | 17 | 1 | 2 | 0 | 15 | 1.0000 | 0.3333 | 0 |
| gretel | new | CREDIT_CARD | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 0 |
| gretel | new | IT_IDENTITY_CARD | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 0 |
| gretel | new | IT_DRIVER_LICENSE | 17 | 0 | 17 | 0 | 0 | 0 | 17 | N/A | N/A | 1 |
| gretel | baseline | PERSON | 18 | 13 | 5 | 8 | 3 | 5 | 2 | 0.6154 | 0.7273 | 0 |
| gretel | baseline | EMAIL_ADDRESS | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 0 |
| gretel | baseline | PHONE_NUMBER | 18 | 0 | 18 | 0 | 3 | 0 | 15 | N/A | 0.0000 | 0 |
| gretel | baseline | IT_FISCAL_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 0 |
| gretel | baseline | IT_VAT_CODE | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 0 |
| gretel | baseline | IBAN_CODE | 18 | 1 | 17 | 1 | 0 | 0 | 17 | 1.0000 | 1.0000 | 0 |
| gretel | baseline | CREDIT_CARD | 18 | 1 | 17 | 0 | 0 | 1 | 17 | 0.0000 | N/A | 0 |
| gretel | baseline | IT_IDENTITY_CARD | 18 | 0 | 18 | 0 | 0 | 0 | 18 | N/A | N/A | 0 |
| gretel | baseline | IT_DRIVER_LICENSE | 17 | 0 | 17 | 0 | 0 | 0 | 17 | N/A | N/A | 1 |
| rizzo | new | PERSON | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 0 |
| rizzo | new | EMAIL_ADDRESS | 10 | 7 | 3 | 7 | 0 | 0 | 3 | 1.0000 | 1.0000 | 0 |
| rizzo | new | PHONE_NUMBER | 10 | 8 | 2 | 8 | 0 | 0 | 2 | 1.0000 | 1.0000 | 0 |
| rizzo | new | IT_FISCAL_CODE | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 0 |
| rizzo | new | IT_VAT_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 0 |
| rizzo | new | IBAN_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 0 |
| rizzo | new | CREDIT_CARD | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 0 |
| rizzo | new | IT_IDENTITY_CARD | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 6 |
| rizzo | new | IT_DRIVER_LICENSE | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 6 |
| rizzo | baseline | PERSON | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 0 |
| rizzo | baseline | EMAIL_ADDRESS | 10 | 7 | 3 | 7 | 0 | 0 | 3 | 1.0000 | 1.0000 | 0 |
| rizzo | baseline | PHONE_NUMBER | 10 | 8 | 2 | 8 | 0 | 0 | 2 | 1.0000 | 1.0000 | 0 |
| rizzo | baseline | IT_FISCAL_CODE | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 0 |
| rizzo | baseline | IT_VAT_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 0 |
| rizzo | baseline | IBAN_CODE | 10 | 0 | 10 | 0 | 0 | 0 | 10 | N/A | N/A | 0 |
| rizzo | baseline | CREDIT_CARD | 10 | 6 | 4 | 6 | 0 | 0 | 4 | 1.0000 | 1.0000 | 0 |
| rizzo | baseline | IT_IDENTITY_CARD | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 6 |
| rizzo | baseline | IT_DRIVER_LICENSE | 4 | 1 | 3 | 1 | 0 | 0 | 3 | 1.0000 | 1.0000 | 6 |
| targeted | new | PERSON | 26 | 5 | 21 | 5 | 0 | 0 | 21 | 1.0000 | 1.0000 | 0 |
| targeted | new | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 0 |
| targeted | new | PHONE_NUMBER | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 0 |
| targeted | new | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 0 |
| targeted | new | IT_VAT_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 0 |
| targeted | new | IBAN_CODE | 26 | 3 | 23 | 3 | 1 | 0 | 22 | 1.0000 | 0.7500 | 0 |
| targeted | new | CREDIT_CARD | 26 | 3 | 23 | 3 | 0 | 0 | 23 | 1.0000 | 1.0000 | 0 |
| targeted | new | IT_IDENTITY_CARD | 26 | 1 | 25 | 0 | 0 | 1 | 25 | 0.0000 | N/A | 0 |
| targeted | new | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 0 |
| targeted | baseline | PERSON | 26 | 5 | 21 | 3 | 0 | 2 | 21 | 0.6000 | 1.0000 | 0 |
| targeted | baseline | EMAIL_ADDRESS | 26 | 4 | 22 | 4 | 0 | 0 | 22 | 1.0000 | 1.0000 | 0 |
| targeted | baseline | PHONE_NUMBER | 26 | 2 | 24 | 1 | 2 | 1 | 22 | 0.5000 | 0.3333 | 0 |
| targeted | baseline | IT_FISCAL_CODE | 26 | 2 | 24 | 2 | 0 | 0 | 24 | 1.0000 | 1.0000 | 0 |
| targeted | baseline | IT_VAT_CODE | 26 | 2 | 24 | 1 | 0 | 1 | 24 | 0.5000 | 1.0000 | 0 |
| targeted | baseline | IBAN_CODE | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0 |
| targeted | baseline | CREDIT_CARD | 26 | 3 | 23 | 2 | 0 | 1 | 23 | 0.6667 | 1.0000 | 0 |
| targeted | baseline | IT_IDENTITY_CARD | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 0 |
| targeted | baseline | IT_DRIVER_LICENSE | 26 | 1 | 25 | 1 | 0 | 0 | 25 | 1.0000 | 1.0000 | 0 |
| ALL | new | PERSON | 54 | 28 | 26 | 28 | 0 | 0 | 26 | 1.0000 | 1.0000 | 0 |
| ALL | new | EMAIL_ADDRESS | 54 | 12 | 42 | 12 | 0 | 0 | 42 | 1.0000 | 1.0000 | 0 |
| ALL | new | PHONE_NUMBER | 54 | 10 | 44 | 10 | 1 | 0 | 43 | 1.0000 | 0.9091 | 0 |
| ALL | new | IT_FISCAL_CODE | 54 | 8 | 46 | 8 | 0 | 0 | 46 | 1.0000 | 1.0000 | 0 |
| ALL | new | IT_VAT_CODE | 54 | 2 | 52 | 2 | 4 | 0 | 48 | 1.0000 | 0.3333 | 0 |
| ALL | new | IBAN_CODE | 54 | 4 | 50 | 4 | 3 | 0 | 47 | 1.0000 | 0.5714 | 0 |
| ALL | new | CREDIT_CARD | 54 | 10 | 44 | 10 | 0 | 0 | 44 | 1.0000 | 1.0000 | 0 |
| ALL | new | IT_IDENTITY_CARD | 48 | 2 | 46 | 1 | 0 | 1 | 46 | 0.5000 | 1.0000 | 6 |
| ALL | new | IT_DRIVER_LICENSE | 47 | 2 | 45 | 2 | 0 | 0 | 45 | 1.0000 | 1.0000 | 7 |
| ALL | baseline | PERSON | 54 | 28 | 26 | 21 | 3 | 7 | 23 | 0.7500 | 0.8750 | 0 |
| ALL | baseline | EMAIL_ADDRESS | 54 | 12 | 42 | 12 | 0 | 0 | 42 | 1.0000 | 1.0000 | 0 |
| ALL | baseline | PHONE_NUMBER | 54 | 10 | 44 | 9 | 5 | 1 | 39 | 0.9000 | 0.6429 | 0 |
| ALL | baseline | IT_FISCAL_CODE | 54 | 8 | 46 | 8 | 0 | 0 | 46 | 1.0000 | 1.0000 | 0 |
| ALL | baseline | IT_VAT_CODE | 54 | 2 | 52 | 1 | 0 | 1 | 52 | 0.5000 | 1.0000 | 0 |
| ALL | baseline | IBAN_CODE | 54 | 4 | 50 | 3 | 0 | 1 | 50 | 0.7500 | 1.0000 | 0 |
| ALL | baseline | CREDIT_CARD | 54 | 10 | 44 | 8 | 0 | 2 | 44 | 0.8000 | 1.0000 | 0 |
| ALL | baseline | IT_IDENTITY_CARD | 48 | 2 | 46 | 2 | 0 | 0 | 46 | 1.0000 | 1.0000 | 6 |
| ALL | baseline | IT_DRIVER_LICENSE | 47 | 2 | 45 | 2 | 0 | 0 | 45 | 1.0000 | 1.0000 | 7 |

## Raw verdict (positive = rejected)

The baseline raw verdict is unchanged, including rejection due to out-of-catalog findings. Gold policy covers only the nine scored categories: this is not an equal-policy comparison. No normalized verdict table is produced. Extras are preserved in observations; no extra label is allowlisted to soften the baseline.

| source | engine | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | falseAcceptanceRate | falseRejectionRate | unknownExcluded |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gretel | new | 18 | 13 | 5 | 13 | 2 | 0 | 3 | 1.0000 | 0.8667 | 0.8889 | 0.8000 | 0.0000 | 0.4000 | 0 |
| gretel | baseline | 18 | 13 | 5 | 11 | 5 | 2 | 0 | 0.8462 | 0.6875 | 0.6111 | 0.4231 | 0.1538 | 1.0000 | 0 |
| rizzo | new | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| rizzo | baseline | 10 | 10 | 0 | 10 | 0 | 0 | 0 | 1.0000 | 1.0000 | 1.0000 | N/A | 0.0000 | N/A | 0 |
| targeted | new | 25 | 18 | 7 | 17 | 0 | 1 | 7 | 0.9444 | 1.0000 | 0.9600 | 0.9722 | 0.0556 | 0.0000 | 0 |
| targeted | baseline | 25 | 18 | 7 | 15 | 3 | 3 | 4 | 0.8333 | 0.8333 | 0.7600 | 0.7024 | 0.1667 | 0.4286 | 0 |
| ALL | new | 53 | 41 | 12 | 40 | 2 | 1 | 10 | 0.9756 | 0.9524 | 0.9434 | 0.9045 | 0.0244 | 0.1667 | 0 |
| ALL | baseline | 53 | 41 | 12 | 36 | 8 | 5 | 4 | 0.8780 | 0.8182 | 0.7547 | 0.6057 | 0.1220 | 0.6667 | 0 |

## Limitations

Small selected external/synthetic pilot, not population-representative or independent samples. Rizzo is not claimed unseen by the Rizzo model. No performance measurements or production quality gate. Accepted does not establish absence of personal data. See README for exhaustive pre-inference review.
