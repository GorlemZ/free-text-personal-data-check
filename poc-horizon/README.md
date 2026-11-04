# PoC Horizon + Transformers.js

Detector di testo libero italiano eseguito in Node.js con `@huggingface/transformers@4.3.2` e il modello `Horizon-Labs/pii-redactor-base` (commit `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`, licenza Apache-2.0 dichiarata nella model card). La model card attribuisce parte dei dati di addestramento CC-BY-4.0 ad ai4privacy e NVIDIA: conservarne l'avviso in caso di ridistribuzione del modello o dell'immagine. È un PoC comparativo, non autenticato e non integrato nel monorepo applicativo. Non inviare dati reali né esporre la porta pubblicamente.

## Preparazione e avvio

```sh
npm ci
npm run prefetch   # artefatti ONNX q8 + tokenizer locali, niente download su richiesta
npm test
npm run smoke      # inferenza reale, inclusa entità in coda e budget token
npm run bench      # stesso corpus sintetico di poc-spacy; aggregati soltanto
npm start          # default 127.0.0.1:8000
```

Il modello è istanziato una volta per processo. `env.allowRemoteModels=false`, percorso locale fisso, `local_files_only=true`, `dtype='q8'`: mancanza di file → startup/readiness falliscono, nessun fallback fp32. `model-manifest.json` fissa revisione, dimensioni e SHA256 dei file ONNX e tokenizer più grandi; i file piccoli sono vincolati alla revisione e controllati per dimensione. I pesi **non** sono in Git. Il Dockerfile copia artefatti prelevati localmente, ne verifica il manifest in build e avvia sotto utente non privilegiato. Smoke offline: `docker run --rm --network none --memory=4g --memory-swap=4g free-text-check:horizon-poc node scripts/smoke.mjs`.

## Contratto PoC

`POST /v1/analyze` richiede `Content-Type: application/json`:

```json
{"fields":[{"fieldId":"description","text":"Servizio digitale.","allowedEntityTypes":[]}]}
```

`200`: `{"verdict":"accepted","modelPolicyVersion":"horizon-pii-redactor-base-q8-ef0eff8e-poc1","findings":[]}` oppure `rejected` con soli `{fieldId,entityType}` ordinati e deduplicati. `400 INVALID_ANALYZE_REQUEST` per schema, chiavi duplicate, limiti o categorie sconosciute; `503 ANALYZER_UNAVAILABLE` su errore di modello, saturazione della coda o input oltre il budget token. `GET /health/ready` restituisce `{"status":"ready"}` dopo il caricamento. Mai testo, frammenti, offset, score o messaggi d'eccezione nelle risposte. Come nel PoC spaCy: 1–16 campi, 2.000 code point/8.000 byte UTF-8 per campo, 32.768 byte per body, `fieldId` nel catalogo chiuso, allowlist di categorie specificata da chiamante **fidato**. 1 inferenza alla volta e al massimo 4 richieste in coda; non equivale a concorrenza del modello. `accepted` significa soltanto nessuna categoria vietata rilevata sopra soglia.

La pipeline JS troncherebbe implicitamente il testo al massimo del tokenizer (8.192 token per questo modello). Per contenere il picco RAM e non analizzare soltanto il prefisso, questa PoC **rifiuta fail-closed** i campi oltre **512 token inclusi i token speciali**, anche se rispettano i limiti di caratteri. Non esegue chunking; questa differenza rispetto a spaCy va mantenuta visibile. La soglia sperimentale è 0,35 sullo score medio dell'aggregazione `simple`, non una probabilità calibrata; l'aggregazione non espone offset e non ricostruisce le entità a cavallo di finestre.

### Categorie

La tabella completa delle 29 etichette BIO è in `src/categories.mjs`. Mappature esplicitamente comparabili: `EMAIL→EMAIL_ADDRESS`, `PHONE→PHONE_NUMBER`; `PERSON`, `ORGANIZATION`, `LOCATION`, `CREDIT_CARD`, `IP_ADDRESS`, `URL` mantengono il nome. Le altre etichette restano native (per esempio `TAX_ID`, `BANK_ACCOUNT`, `DATE`, `NATIONAL_ID`) e sono rifiutate per default quando rilevate. In particolare `TAX_ID` **non** è `IT_FISCAL_CODE`, `BANK_ACCOUNT` **non** è `IBAN_CODE`, e `DATE` **non** è automaticamente `DATE_TIME`; queste tre categorie Presidio non sono ammesse in `allowedEntityTypes`. La PoC Horizon **non è un sostituto drop-in** del servizio Presidio. Il benchmark fornisce `commonCategories`, `commonDetector`, `commonPolicy` per il vocabolario condiviso, e `unsupportedMonitored`/`unsupportedExpected` separati; `detector` e `policy` completi sono solo diagnostici e non vanno confrontati direttamente con gli aggregati spaCy. La precisione/recall su dieci esempi sintetici non rappresenta prestazioni reali.

## Misure di memoria

`node bench/container-memory.mjs free-text-check:horizon-poc 2 1000 4g` esegue due container nuovi con limite fisso 4 GiB, 20 richieste di warmup e 1.000 testi sintetici nuovi per serie: ogni richiesta contiene 16–40 pseudo-parole inedite, 4 client nell'ultimo 10% (l'inferenza resta seriale). Replica con `free-text-check:spacy-poc`. Riporta RSS PID 1, cgroup `memory.current`, `anon`, `file`, picco/eventi se disponibili, latenza e errori; `memory.current` comprende file-cache e non equivale a RSS. Un watchdog campiona ogni 25 richieste e interrompe il carico oltre l'80% del limite, senza usare OOM come cleanup. Criterio **indicativo**: tra checkpoint 500 e 1000 RSS e anon non salgono oltre 20% della baseline al 500, nessun errore/OOM e uso cgroup finale sotto il 75% del limite. In container con `memory.peak` assente si riportano soltanto massimi campionati: non sono massimi assoluti. Gli stessi limiti di carico, di hardware e di durata impediscono di garantire stabilità indefinita o un sizing di produzione.

## Risultati

I risultati delle prove del giorno sono registrati in [`.hermes/notes/poc-horizon-comparison-progress.md`](../.hermes/notes/poc-horizon-comparison-progress.md) alla root, compresi limiti e anomalie. Due serie da 1.000 richieste nuove hanno concluso senza errori/OOM a 4 GiB; RSS Horizon massima campionata ~1602,5 MiB, finale ~1557 MiB. Fra 500 e 750 richieste con testi medi non si osserva salita netta, mentre la transizione a testi lunghi al checkpoint 768 aumenta RSS di ~24 MiB. Queste due serie non dimostrano una cache con limite superiore permanente. L'immagine finale è ~1508,7 MiB su disco, da non confondere con RSS o cgroup.
