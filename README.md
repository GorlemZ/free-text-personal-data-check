# Free-text personal-data check — due PoC comparabili

| Implementazione | Cartella | Motore | Stato |
|---|---|---|---|
| Storica | [`poc-spacy/`](poc-spacy/) | Python, Presidio + spaCy italiano | Software originale spostato senza modifiche funzionali |
| Candidata | [`poc-horizon/`](poc-horizon/) | Node.js, Transformers.js + Horizon ONNX q8 + regex CF | PoC sperimentale, non sostituto drop-in |

Entrambe espongono `GET /health/ready` e `POST /v1/analyze` con struttura di richiesta/risposta simile. **Le categorie e i risultati differiscono**: Horizon usa 29 label native, alcune mappate esplicitamente; la categoria `IT_FISCAL_CODE` è ora rilevata nel PoC Horizon da una regex sintattica locale, non da `TAX_ID` e senza controllo del checksum. La prima PoC non è stata alterata per migliorare artificialmente il confronto. Nessuna delle due implementazioni è integrata in un processo o qualificata per produzione.

La suite condivisa con corpus sintetico, metriche per 18 categorie e prove HTTP è documentata in [`comparison/README.md`](comparison/README.md). Le 8 categorie senza equivalente Horizon restano fuori dalla sua matrice di detection, ma le label native extra continuano a incidere sul verdetto.

## Test locali

```sh
cd poc-spacy && uv sync --frozen --extra dev && uv run --frozen --extra dev pytest -q
cd ../poc-horizon && npm ci && npm run prefetch && npm test && npm run smoke && npm run bench
```

Il download del modello (circa 676 MB tra ONNX quantizzato e tokenizer) avviene durante `npm run prefetch`, mai per richiesta. `poc-horizon/models/` e `node_modules/` sono esclusi da Git. Il modello è fissato al commit `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`; il manifest controlla dimensione e SHA256 dei due artefatti grandi.

## Container e memoria

```sh
docker build -t free-text-check:spacy-poc ./poc-spacy
docker build -t free-text-check:horizon-poc ./poc-horizon
cd poc-horizon
node bench/contract-http.mjs free-text-check:spacy-poc free-text-check:horizon-poc
cd ..
docker run --rm --network none --memory=4g --memory-swap=4g free-text-check:horizon-poc node scripts/smoke.mjs
cd poc-horizon
node bench/container-memory.mjs free-text-check:horizon-poc 2 1000
node bench/container-memory.mjs free-text-check:spacy-poc 2 1000
```

Il probe crea container nuovi, lega la porta HTTP **solo a 127.0.0.1**, genera testi soltanto sintetici con pseudo-parole inedite a ogni richiesta, fa warmup e registra checkpoint di RSS del PID 1, `memory.current`, `anon`, file-cache e `memory.peak` quando disponibile. Un watchdog arresta il carico all'80% del limite per evitare l'OOM ordinario; riporta errori/OOM e rimuove i container. Il limite di 4 GiB è **sperimentale**, non una scelta di produzione. Il confronto di memoria riguarda un solo processo per container; gli ultimi invii provano quattro client, ma il servizio Horizon serializza intenzionalmente l'inferenza. L'assenza di OOM in due serie bounded non costituisce una garanzia di crescita nulla a tempo indefinito.

Per avviare l'API su una porta pubblicata occorre configurare `ANALYZER_BIND_HOST=0.0.0.0` **solo** in una rete di prova isolata e con `-p 127.0.0.1:8000:8000`; i servizi non autenticano i chiamanti. **Non inviare dati personali reali né esporre la porta pubblicamente.** Per le prove, **usa soltanto dati sintetici.** Dettagli e limiti: [`poc-horizon/README.md`](poc-horizon/README.md) e [`poc-spacy/README.md`](poc-spacy/README.md).

**Misure locali storiche (prima della regex CF; 2 × 1.000 richieste per motore, limite 4 GiB):** Horizon q8 ha concluso senza errori/OOM, RSS massima *campionata* 1602,5 MiB e 1556,9 MiB al termine della seconda serie; spaCy ha concluso senza errori/OOM, RSS 185,0 MiB al termine, con una salita monotona di circa 4,4 MiB fra 500 e 1.000 richieste. Horizon è sostanzialmente piatto tra 500 e 750 richieste a lunghezza media, ma cresce di ~23 MiB dopo il passaggio ai testi lunghi; non si può ancora garantire un limite della sua cache. Immagini Docker precedenti: Horizon ~1508,7 MiB, spaCy ~808,4 MiB. Serie complete e anomalie: [risultati PoC](.hermes/notes/poc-horizon-comparison-progress.md).
