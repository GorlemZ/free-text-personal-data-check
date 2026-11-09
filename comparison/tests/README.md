# Test del confronto (senza Docker)

Questa cartella contiene i **test automatici del runner**, non le prove di accuratezza o di carico dei detector. Dalla root del repository, con Node.js ≥22 e dopo `npm ci` in `poc-horizon/`:

```sh
node --test comparison/tests/*.test.mjs
```

| File | Verifica | Non dimostra |
| --- | --- | --- |
| [`corpus.test.mjs`](corpus.test.mjs) | Formato del corpus, 18 coppie positivo/negativo, casi neutro e allowlist, categorie supportate | Che i detector riconoscano davvero quei casi |
| [`contract.test.mjs`](contract.test.mjs) | Schema HTTP, risposte senza testo, validazione e gestione deterministica di errori/coda con handler Horizon iniettato | Che Presidio e il modello Horizon siano accurati |
| [`metrics.test.mjs`](metrics.test.mjs) | Calcolo delle matrici detection/verdetto; categorie unsupported ed errori tecnici distinti da FP/FN | Che le annotazioni del corpus siano corrette |
| [`http-client.test.mjs`](http-client.test.mjs) | Distinzione dei guasti di trasporto dalle risposte HTTP malformate, senza esporre payload | Prestazioni della rete nel deployment finale |
| [`docker-lifecycle.test.mjs`](docker-lifecycle.test.mjs) | Tracciamento e cleanup simulato dei container | Disponibilità di Docker o memoria sufficiente |

**Percorso di valutazione:**

1. **Business:** esaminare [`../corpus.json`](../corpus.json) e le annotazioni `expectedEntities` (categoria attesa) ed `expectedVerdict` (esito atteso dopo `allowedEntityTypes`). Gli ID sono sintetici; verificare anche le categorie fuori copertura e i casi in cui una categoria inattesa causa un falso rifiuto. Ampliare il corpus con esempi *sintetici* e attese motivate, mai con dati personali reali nel repository o nelle segnalazioni.
2. **Infra:** costruire le due immagini e lanciare [`../run.mjs`](../run.mjs) come indicato in [`../README.md`](../README.md). Il run esercita i due servizi HTTP reali, misura cold dopo readiness, warm, bulk e burst e produce aggregati; eseguire separatamente le [prove di memoria](../../poc-horizon/README.md#misure-di-memoria). L'assenza di errori in un singolo run non è una garanzia di throughput o stabilità.
3. **Insieme:** distinguere *detection* con allowlist vuota da *policy* con categorie consentite. I falsi positivi e negativi del corpus non fanno fallire la suite: sono risultati da discutere. Errori di contratto o dati del corpus invalidi fanno invece fallire il run.

Le suite specifiche dei motori sono in [`../../poc-spacy/tests/`](../../poc-spacy/tests/) e [`../../poc-horizon/tests/`](../../poc-horizon/tests/). Il [README principale](../../README.md#perché-unapi-http) spiega perché la prova end-to-end usa una API comune invece di chiamare direttamente le librerie.
