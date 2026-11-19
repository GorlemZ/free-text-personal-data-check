# Valutazione funzionale BardsAI

Il golden `category-detection-1` contiene 142 casi. Ogni testo viene inviato una volta al servizio BardsAI con policy deny-all; il collector salva soltanto ID caso, categorie attese/osservate, verdetti e contatori.

## Risultato pubblicato

| Motore | TP | FP | FN | TN | Verdetti corretti | Body esatti |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| BardsAI v2 | 96 | 7 | 3 | 36 | 132/142 — 92,96% | 125/142 — 88,03% |

[Report](results/bardsai-v2-category-detection-2026-11-18/report.md) · [Bundle JSON](results/bardsai-v2-category-detection-2026-11-18/results.json) · [Sintesi tecnica](../../REPORT.md)

## Validazione e raccolta

```sh
python3 tests/evaluation/runner.py --validate-only \
  --gold tests/evaluation/gold.json

python3 tests/evaluation/runner.py \
  --gold tests/evaluation/gold.json \
  --bardsai-url http://127.0.0.1:18084 \
  --timeout 60 \
  --output tests/evaluation/results/my-run
```

`--output` deve indicare un percorso nuovo. Una risposta HTTP, JSON o contrattuale non valida interrompe la raccolta senza produrre un bundle finale.

## Output

- `results.json`: ricevuta sanificata;
- `summary.csv`: totali per motore;
- `verdict.csv`: matrice TP/FP/FN/TN;
- `category.csv`: metriche per categoria;
- `differences.csv`: soli mismatch per ID caso;
- `report.md`: sintesi leggibile.
- `provenance.json` nel bundle pubblicato: hash del golden, modello/revisione, runtime e immagine della raccolta originale.

Il runner supporta il rerender offline dei sei output deterministici con `--render results.json --output NEW_DIR`; tali output devono risultare byte-identici. `provenance.json` documenta la raccolta pubblicata e non viene rigenerato. Testo originale, span, score, confidence e body grezzi restano esclusi.

Il golden contiene dati sintetici e casi derivati da precedenti corpus di test. Gli ID sono identificatori di provenienza e non indicano motori ancora presenti nel repository.
