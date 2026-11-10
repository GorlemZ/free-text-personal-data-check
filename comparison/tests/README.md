# Test del confronto senza inferenza o Docker

```sh
node --test comparison/tests/*.test.mjs
```

`functional-corpus` e `migration` verificano il gold unico e il manifest; `functional-config` verifica configurazione e tokenizer locale senza caricare pesi. `gold-checks` controlla checksum con algoritmi indipendenti dal generatore e dai PoC.

`contract` e `http-client` conservano i gate HTTP, privacy, coda ed errori. `functional-http`, `functional-run` e `functional-cli` esercitano la pipeline con server loopback finti; `functional-docker` usa un command adapter finto, mai Docker. `functional-metrics` e `functional-report` verificano denominatori indipendenti, integrità, bundle sanitizzati e render standalone.

Questi test non attestano la qualità dei modelli e non completano la review indipendente del gold. Consultare `../README.md` prima di autorizzare un run reale.
