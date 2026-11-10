# Pipeline funzionale

Questo percorso contiene il solo runner mantenuto. Corpus e manifest sono nella cartella superiore; non ci sono più dataset pilota/corner separati. Vedi `../README.md` per policy, gate, comandi e limiti.

- `load-corpus.mjs`: schema, integrità manifest, deduplicazione detection e strata policy.
- `config.mjs` / `capabilities.json`: configurazione verificabile, tokenizer locale e registry.
- `collect.mjs`: unico collector HTTP e proiezione sanitizzata, condiviso dal runner e dai test.
- `docker-runner.mjs`: isolamento, readiness e cleanup delle risorse proprie.
- `run.mjs`: orchestrazione, gate review/allineamento/immagini/versioni e scrittura atomica.
- `metrics.mjs` / `report.mjs`: calcolo puro con denominatori indipendenti e render offline.

Gold e allineamento sono pending; le prove HTTP con fake service non costituiscono un benchmark.
