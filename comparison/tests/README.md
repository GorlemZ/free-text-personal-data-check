# Test della suite, senza inferenza o Docker reali

```sh
node --test comparison/tests/*.test.mjs
```

Richiedono le dipendenze dei due PoC, il tokenizer locale Horizon e l'ambiente `poc-spacy/.venv/bin/python` con i metadati telefonici previsti dal gold.

- `functional-corpus`, `migration`: schema gold/manifest, conteggi, deduplicazione coerente, generator deterministico e reset della review. Nessun requisito di hash.
- `gold-checks`: copertura delle sette categorie, allowlist, famiglie e controlli checksum indipendenti dai detector; validazione telefonica offline.
- `functional-config`: mapping e tokenizer locale senza caricare i pesi.
- `contract`, `http-client`: protocollo HTTP, assenza di body grezzi nelle ricevute e distinzione errori; nessuna misura temporale.
- `functional-http`, `functional-run`, `functional-cli`: vere richieste a server loopback finti, percorso CLI e collector condiviso, risposte valide/400/503/timeout/malformate, versioni incoerenti, interruzioni e non tentati.
- `functional-docker`: command adapter simulato; image ID immutabile, collisioni, errori e cleanup delle sole risorse proprie, senza avviare Docker.
- `functional-metrics`, `functional-report`: matrici note anche sbilanciate, denominatori indipendenti, schema senza raw, confronto diretto col gold caricato, render autonomo e supporto del catalogo storico.

Questi test non misurano sensibilità o accuratezza dei detector e non sostituiscono la review indipendente delle annotazioni. Il run HTTP sui servizi Docker reali è descritto in `../README.md`.
