# Functional comparison — COMPLETE

Development sample; correlated policy scenarios. Delta is arithmetic, not statistical significance.

| Categoria | N+ / N− appaiati | Recall Presidio | Recall Horizon | Precisione P/H | FP/FN P/H | Δ recall |
| --- | --- | --- | --- | --- | --- | --- |
| CREDIT_CARD | 23 / 98 | 100.0% | 100.0% | 100.0% / 100.0% | 0/0 / 0/0 | 0.0% |
| EMAIL_ADDRESS | 7 / 114 | 85.7% | 100.0% | 100.0% / 77.8% | 0/1 / 2/0 | 14.3% |
| IBAN_CODE | 4 / 117 | 100.0% | 100.0% | 100.0% / 100.0% | 0/0 / 0/0 | 0.0% |
| IT_FISCAL_CODE | 4 / 117 | 100.0% | 100.0% | 100.0% / 100.0% | 0/0 / 0/0 | 0.0% |
| IT_VAT_CODE | 7 / 114 | 100.0% | 100.0% | 100.0% / 100.0% | 0/0 / 0/0 | 0.0% |
| PERSON | 9 / 112 | 88.9% | 100.0% | 61.5% / 90.0% | 5/1 / 1/0 | 11.1% |
| PHONE_NUMBER | 15 / 106 | 100.0% | 100.0% | 100.0% / 100.0% | 0/0 / 0/0 | 0.0% |

| Motore | N policy | Rifiuti corretti | Accettazioni corrette | Accettazioni indebite | Rifiuti indebiti | Accuracy | Balanced accuracy | Errori |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| presidio | 185 | 73 | 105 | 2 | 5 | 96.2% | 96.4% | 0 (non tentate 0) |
| horizon | 185 | 75 | 107 | 0 | 3 | 98.4% | 98.6% | 0 (non tentate 0) |

| Motore | Accettazioni indebite / attesi rifiutati | Rifiuti indebiti / attesi accettati | Set categorie esatto nel catalogo (detection) |
| --- | --- | --- | --- |
| presidio | 2/75 (2.7%) | 5/110 (4.5%) | 114/121 (94.2%) |
| horizon | 0/75 (0.0%) | 3/110 (2.7%) | 118/121 (97.5%) |

| Motore | Probe | Pianificate | Tentate | Riuscite | Errori tecnici | Errori contratto | Non tentate |
| --- | --- | --- | --- | --- | --- | --- | --- |
| presidio | detection | 121 | 121 | 121 | 0 | 0 | 0 |
| presidio | policy | 185 | 185 | 185 | 0 | 0 | 0 |
| horizon | detection | 121 | 121 | 121 | 0 | 0 | 0 |
| horizon | policy | 185 | 185 | 185 | 0 | 0 | 0 |

Paired denominators include only IDs with successful responses from both engines. Own-engine and paired counts, excluded probes, and zero-denominator nulls are in CSV/JSON.
Policy positive = rejected. Accuracy and exact category-set correctness measure different outcomes. Technical errors are excluded from TP/FP/FN/TN.
Out-of-catalog findings: 0. For the current seven-category contract these indicate an application-policy discrepancy; historical bundles retain their original catalog.
