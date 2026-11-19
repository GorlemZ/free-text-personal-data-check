# BardsAI v2 — category-detection golden

Gold: `category-detection-1` — 142 cases and HTTP responses.
One deny-all request per case. Category-presence scoring; no span or entity-count scoring.

## Summary

| engine | cases | verdictCorrect | verdictIncorrect | bodyMatch | bodyMismatch |
| --- | --- | --- | --- | --- | --- |
| bardsai-v2 | 142 | 132 | 10 | 125 | 17 |

## Verdict (positive = rejected)

| engine | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy | falseAcceptanceRate | falseRejectionRate |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bardsai-v2 | 142 | 99 | 43 | 96 | 7 | 3 | 36 | 0.9697 | 0.9320 | 0.9296 | 0.9035 | 0.0303 | 0.1628 |

## Categories

| engine | category | n | positive | negative | tp | fp | fn | tn | recall | precision | accuracy | balancedAccuracy |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| bardsai-v2 | PERSON | 142 | 61 | 81 | 58 | 1 | 3 | 80 | 0.9508 | 0.9831 | 0.9718 | 0.9692 |
| bardsai-v2 | EMAIL_ADDRESS | 142 | 22 | 120 | 22 | 0 | 0 | 120 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| bardsai-v2 | PHONE_NUMBER | 142 | 16 | 126 | 16 | 6 | 0 | 120 | 1.0000 | 0.7273 | 0.9577 | 0.9762 |
| bardsai-v2 | IT_FISCAL_CODE | 142 | 14 | 128 | 14 | 0 | 0 | 128 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| bardsai-v2 | IT_VAT_CODE | 142 | 6 | 136 | 6 | 1 | 0 | 135 | 1.0000 | 0.8571 | 0.9930 | 0.9963 |
| bardsai-v2 | IBAN_CODE | 142 | 8 | 134 | 8 | 1 | 0 | 133 | 1.0000 | 0.8889 | 0.9930 | 0.9963 |
| bardsai-v2 | CREDIT_CARD | 142 | 14 | 128 | 14 | 3 | 0 | 125 | 1.0000 | 0.8235 | 0.9789 | 0.9883 |
| bardsai-v2 | IT_IDENTITY_CARD | 142 | 4 | 138 | 3 | 0 | 1 | 138 | 0.7500 | 1.0000 | 0.9930 | 0.8750 |
| bardsai-v2 | IT_DRIVER_LICENSE | 142 | 5 | 137 | 4 | 0 | 1 | 137 | 0.8000 | 1.0000 | 0.9930 | 0.9000 |

Differences: 17 cases. See `differences.csv` (IDs and categories only).

## Scope

Development oracle, not a held-out production estimate. Responses are sanitized: no input text, spans, scores, or raw bodies are retained.
