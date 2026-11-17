# Category-detection golden

`gold.json` contiene esclusivamente il catalogo, gli identificativi dei casi, i testi e le categorie attese. Il runner invia ogni testo una sola volta a ciascun motore con `allowedCategories: []` e confronta separatamente verdetto, body business completo e categorie.

[Contratto HTTP](../contract/README.md) · [Suite automatiche](../README.md) · [Attribuzioni minime](SOURCES.md)

## Validazione e test

Dalla root del repository:

```sh
python3 tests/evaluation/runner.py --validate-only
python3 -m unittest discover -s tests/evaluation/tests -v
```

Il corpus `category-detection-1` contiene 142 casi autonomi e produce 426 POST: una per caso e motore. Non contiene allowlist di policy, provenance, span, offset, score, hash, note di review o configurazioni di tokenizzazione/memoria.

## Confronto HTTP

Con i tre servizi invariati già disponibili:

```sh
python3 tests/evaluation/runner.py \
  --gold tests/evaluation/gold.json \
  --rizzo-url http://127.0.0.1:18081 \
  --horizon-url http://127.0.0.1:18082 \
  --presidio-url http://127.0.0.1:18083 \
  --timeout 60 \
  --output tests/evaluation/results/my-run
```

La directory di output deve essere nuova. Se la sua directory padre esiste ed è scrivibile, il runner crea la directory richiesta. Se la directory padre manca o non è utilizzabile, i sei file vengono scritti direttamente nella root del progetto, purché nessuno dei sei nomi sia già presente. Questa destinazione viene risolta prima di qualsiasi richiesta. Le URL sono basi senza `/v1/analyze`. Il runner non esegue retry e non modifica o testa internamente i servizi. HTTP non-200, timeout, errore di trasporto o risposta contrattualmente invalida interrompono il run e non diventano errori di classificazione.

## Output

Un run completo produce:

- `results.json`: bundle chiuso schema 3, senza testi;
- `summary.csv`: verdict corretti e body esatti;
- `verdict.csv`: matrice del verdetto per motore;
- `category.csv`: matrici per categoria;
- `differences.csv`: soli casi con body diverso dall'atteso;
- `report.md`: sintesi Markdown.

Il bundle può essere renderizzato senza rete e senza il golden:

```sh
python3 tests/evaluation/runner.py \
  --render tests/evaluation/results/category-detection-v3-2026-11-17/results.json \
  --output tests/evaluation/results/category-detection-v3-render-check
```

Il renderer rifiuta bundle incompleti, campi extra, tuple duplicate o mancanti, ordine errato e flag derivati incoerenti.

## Metodo

- Un caso equivale a un testo e a un campo HTTP fisso `fieldId: "text"`.
- `expected: []` implica `accepted`; qualsiasi categoria attesa implica `rejected`.
- Il golden ordina le categorie secondo il catalogo. Il body HTTP deve rispettare l'ordine UTF-16 del contratto; il runner verifica il wire prima della proiezione canonica.
- Le metriche misurano presenza della categoria nel testo, non entità o span.
- Sensibilità = TP/(TP+FN); precisione = TP/(TP+FP); accuracy = (TP+TN)/N. I denominatori nulli sono `null`/`N/A`.
- Il corpus conserva positivi, negativi, near-miss, checksum errati riconoscibili, overlap e formati insoliti. Non contiene scenari dedicati a policy, error handling, limiti, memoria o overload.

Il corpus è un oracle di sviluppo, non held-out. Le percentuali descrivono questi 142 testi e non attestano rappresentatività produttiva. Un verdetto `accepted` non prova l'assenza di dati personali.
