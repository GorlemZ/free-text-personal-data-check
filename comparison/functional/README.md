# Pipeline funzionale

Un solo percorso: gold → HTTP ai container Docker → risposta associata all'ID → confronto → tabella. Policy, comandi e limiti sono in `../README.md`.

- `load-corpus.mjs`: valida `corpus.json` (sole stringhe complete) e `gold.json` (metadati con `textIndex`), controlla indici, conteggi e collegamenti; restituisce esattamente il testo letterale a detection e policy senza composizione. `fieldId` è solo il wrapper HTTP. Nessun hash.
- `config.mjs` / `capabilities.json`: supporti descrittivi e conteggio token locale senza inferenza o troncamento; **nessuna seconda tabella** di mapping editabile.
- `category-map.mjs`: unica traduzione gold semantico→tutte le label native per allowlist e label native→categoria gold per scoring. Horizon `PHONE` e `PHONE_NUMBER` sono produttori distinti della stessa categoria.
- `collect.mjs`: unico collector HTTP usato dalla CLI e dai test; richiesta/risposta native, proiezione dei soli campi ammessi e snapshot del mapping nel bundle schema 2.
- `docker-runner.mjs`: image ID locale, binding loopback, un container alla volta e cleanup delle sole risorse proprie. Bridge predefinito, nessuna prova egress.
- `run.mjs`: gold revisionato, readiness, smoke contrattuale, raccolta, registrazione delle versioni osservate e scrittura dei risultati validati. Nessun gate di approvazione capability o digest atteso manuale.
- `metrics.mjs` / `report.mjs`: denominatori detection/policy distinti, errori separati e render standalone dallo snapshot schema 2; il lettore schema 1 storico rimane congelato e non importa il mapping corrente.

Un run completo basta. Nessuna metrica memoria/CPU/latenza. Le prove con HTTP e Docker simulati verificano la suite, non la qualità dei detector reali.
