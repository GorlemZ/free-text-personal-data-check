# Valutazione golden

Il corpus `category-detection-1` contiene 142 casi. La [run storica del 17 novembre](results/category-detection-v3-2026-11-17/report.md) copre Horizon, Rizzo e Presidio (426 risposte); la [run BardsAI](results/bardsai-v2-category-detection-2026-11-18/report.md) è distinta. Nessuna è una nuova misura a quattro motori. Il corpus è di sviluppo, non held-out.

`python3 tests/evaluation/runner.py --validate-only` controlla il corpus senza inferenza. Il runner accetta uno o più endpoint tra `--rizzo-url`, `--horizon-url`, `--presidio-url` e `--bardsai-url`; per confrontarli tutti fornire tutte e quattro le opzioni e una nuova directory `--output`. Ogni caso produce una richiesta per endpoint selezionato (568 in totale per quattro); un errore tecnico interrompe la raccolta. Non esegue retry. La raccolta è opt-in e richiede servizi avviati.

I bundle storici possono essere renderizzati offline con `--render <results.json> --output <nuova-directory>`. I risultati contengono categorie e verdetti, non i testi originali.
