# Test della suite, senza inferenza o Docker reali

```sh
node --test comparison/tests/*.test.mjs
```

Richiedono le dipendenze dei due PoC, il tokenizer locale Horizon e l'ambiente `poc-spacy/.venv/bin/python` con i metadati telefonici previsti dal gold.

- `literal-input`, `functional-corpus`, `migration`: corpus come array di stringhe letterali complete, gold separato con indici validi e annotazioni pending; schema chiuso, scenari policy condivisi, rifiuto di testo/metadati incoerenti e audit delle vecchie quote e famiglie. Nessun generatore o requisito di hash. Le quote del draft non dimostrano realismo.
- `gold-checks`: copertura delle nove categorie e negativi mirati, allowlist, famiglie, checksum indipendenti, morfologia CIE e sottotipo di patente documentato; validazione telefonica offline. CIE e patente non hanno verifica di assegnazione o del carattere di controllo.
- `category-map`, `functional-config`: mapping bidirezionale unico, espansione doppia del telefono Horizon, capacità e tokenizer locale senza caricare i pesi.
- `contract`, `http-client`: protocollo HTTP, assenza di body grezzi nelle ricevute e distinzione errori; nessuna misura temporale.
- `functional-http`, `functional-run`, `functional-cli`: vere richieste a server loopback finti, percorso CLI e collector condiviso, risposte valide/400/503/timeout/malformate, versioni incoerenti, interruzioni e non tentati.
- `functional-docker`: command adapter simulato; image ID immutabile, collisioni, errori e cleanup delle sole risorse proprie, senza avviare Docker.
- `functional-metrics`, `functional-report`, `historical-byte-identity`: matrici note anche sbilanciate, denominatori indipendenti, schema senza raw, confronto diretto col gold caricato, render autonomo schema 2 e render byte-identico dei tre bundle schema 1 preesistenti.

Questi test non misurano sensibilità o accuratezza dei detector e non sostituiscono la review indipendente delle annotazioni. Il run HTTP sui servizi Docker reali è descritto in `../README.md`.
