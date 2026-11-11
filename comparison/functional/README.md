# Pipeline funzionale

Un solo percorso: gold → HTTP ai container Docker → risposta associata all'ID → confronto → tabella. Policy, comandi e limiti sono in `../README.md`.

- `load-corpus.mjs`: schema, conteggi derivati, deduplicazione detection e collegamenti agli scenari policy. Nessun hash.
- `config.mjs` / `capabilities.json`: mapping e supporti descrittivi; conteggio token locale senza inferenza o troncamento.
- `collect.mjs`: unico collector HTTP usato dalla CLI e dai test; proiezione dei soli campi ammessi.
- `docker-runner.mjs`: image ID locale, binding loopback, un container alla volta e cleanup delle sole risorse proprie. Bridge predefinito, nessuna prova egress.
- `run.mjs`: gold revisionato, readiness, smoke contrattuale, raccolta, registrazione delle versioni osservate e scrittura dei risultati validati. Nessun gate di approvazione capability o digest atteso manuale.
- `metrics.mjs` / `report.mjs`: denominatori detection/policy distinti, errori separati e render senza corpus corrente.

Un run completo basta. Nessuna metrica memoria/CPU/latenza. Le prove con HTTP e Docker simulati verificano la suite, non la qualità dei detector reali.
