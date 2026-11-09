# PoC Horizon + Transformers.js

Detector di testo libero italiano eseguito in Node.js con `@huggingface/transformers@4.3.2`, il modello `Horizon-Labs/pii-redactor-base` e una regola locale per il codice fiscale italiano (commit del modello `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`, licenza Apache-2.0 dichiarata nella model card). La model card attribuisce parte dei dati di addestramento CC-BY-4.0 ad ai4privacy e NVIDIA: conservarne l'avviso in caso di ridistribuzione del modello o dell'immagine. **Non inviare dati personali reali né esporre la porta pubblicamente.** Per le prove, **usa soltanto dati sintetici.**

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

`200`: `{"verdict":"accepted","modelPolicyVersion":"horizon-pii-redactor-base-q8-ef0eff8e-poc2","findings":[]}` oppure `rejected` con soli `{fieldId,entityType}` ordinati e deduplicati. `400 INVALID_ANALYZE_REQUEST` per schema, chiavi duplicate, limiti o categorie sconosciute; `503 ANALYZER_UNAVAILABLE` su errore di modello, saturazione della coda o input oltre il budget token. `GET /health/ready` restituisce `{"status":"ready"}` dopo il caricamento. Mai testo, frammenti, offset, score o messaggi d'eccezione nelle risposte. Come nel PoC spaCy: 1–16 campi, 2.000 code point/8.000 byte UTF-8 per campo, 32.768 byte per body, `fieldId` nel catalogo chiuso, allowlist di categorie specificata da chiamante **fidato**. 1 inferenza alla volta e al massimo 4 richieste in coda; non equivale a concorrenza del modello. `accepted` significa soltanto nessuna categoria vietata rilevata dal modello sopra soglia né dal recognizer CF.

La pipeline JS troncherebbe implicitamente il testo al massimo del tokenizer (8.192 token per questo modello). Per contenere il picco RAM e non analizzare soltanto il prefisso, questa PoC **rifiuta fail-closed** i campi oltre **512 token inclusi i token speciali**, anche se rispettano i limiti di caratteri. Non esegue chunking; questa differenza rispetto a spaCy va mantenuta visibile. La soglia sperimentale è 0,35 sullo score medio dell'aggregazione `simple`; l'aggregazione non espone offset e non ricostruisce le entità a cavallo di finestre.

### Categorie

La tabella completa delle 29 etichette BIO Horizon è in `src/categories.mjs`. Mappature esplicitamente comparabili: `EMAIL→EMAIL_ADDRESS`, `PHONE→PHONE_NUMBER`; `PERSON`, `ORGANIZATION`, `LOCATION`, `CREDIT_CARD`, `IP_ADDRESS`, `URL` mantengono il nome. Le altre etichette restano native (per esempio `TAX_ID`, `BANK_ACCOUNT`, `DATE`, `NATIONAL_ID`) e sono rifiutate per default quando rilevate. In particolare `TAX_ID` **non** è `IT_FISCAL_CODE`, `BANK_ACCOUNT` **non** è `IBAN_CODE`, e `DATE` **non** è automaticamente `DATE_TIME`; `IBAN_CODE` e `DATE_TIME` non sono ammessi in `allowedEntityTypes`. `IT_FISCAL_CODE` è invece una categoria aggiuntiva prodotta solo dalla regex locale `src/fiscal-code.mjs`.

Il recognizer CF cerca la forma canonica di 16 caratteri: sei lettere ASCII, due cifre, mese `ABCDEHLMPRST`, giorno `01–31` o `41–71`, una lettera e tre cifre, lettera finale. Riconosce anche minuscole, con confini non adiacenti a lettere, segni combinanti, numeri Unicode o `_`. Non controlla checksum, coerenza calendario/anagrafica o esistenza del codice catastale; le varianti per omocodia non sono supportate. Un identificativo di forma plausibile può quindi essere un falso positivo e un CF con omocodia un falso negativo. La regex viene applicata solo dopo l'inferenza riuscita di ogni campo e non aggira il limite di 512 token. Le categorie native eventualmente co-emesse restano distinte e possono ancora causare il rifiuto, anche se `IT_FISCAL_CODE` è in allowlist: nessuna etichetta `DRIVER_LICENSE`, `VEHICLE_ID` o `TAX_ID` viene rimappata o interpretata come prova di quel tipo di documento.

La PoC Horizon **non è un sostituto drop-in** del servizio Presidio. Il benchmark specifico del motore include la regex CF insieme all'inferenza e riporta questa categoria tra le categorie confrontabili, senza suggerire che il modello Horizon la emetta nativamente. Il suo corpus di dieci esempi sintetici contiene un solo CF; nel run aggiornato questa voce risulta rilevata (`IT_FISCAL_CODE`: 1 TP, 0 FN). La [suite condivisa](../comparison/README.md) usa invece 39 campioni sintetici per 18 categorie: `IBAN_CODE` e `DATE_TIME` restano non supportati nella matrice Horizon, mentre le label native extra possono incidere sul verdetto. Nessuno dei due corpus rappresenta precisione/recall su dati reali.

## Misure di memoria

`node bench/container-memory.mjs free-text-check:horizon-poc 2 1000 4g` esegue due container nuovi con limite fisso 4 GiB, 20 richieste di warmup e 1.000 testi sintetici nuovi per serie: ogni richiesta contiene 16–40 pseudo-parole inedite, 4 client nell'ultimo 10% (l'inferenza resta seriale). Replica con `free-text-check:spacy-poc`. Riporta RSS PID 1, cgroup `memory.current`, `anon`, `file`, picco/eventi se disponibili, latenza e errori; `memory.current` comprende file-cache e non equivale a RSS. Un watchdog campiona ogni 25 richieste e interrompe il carico oltre l'80% del limite, senza usare OOM come cleanup. Criterio **indicativo**: tra checkpoint 500 e 1000 RSS e anon non salgono oltre 20% della baseline al 500, nessun errore/OOM e uso cgroup finale sotto il 75% del limite. In container con `memory.peak` assente si riportano soltanto massimi campionati: non sono massimi assoluti. Gli stessi limiti di carico, di hardware e di durata impediscono di garantire stabilità indefinita o un sizing di produzione.

## Risultati

Le misure sono nel [progress del PoC](../.hermes/plans/poc-horizon-comparison/progress.md), con condizioni, anomalie e report distinti. **Prima della regola CF**, due serie da 1.000 richieste sintetiche per motore hanno concluso senza errori/OOM a 4 GiB; RSS massima Horizon *campionata* ~1602,5 MiB. Tra 500 e 750 richieste a lunghezza media non si osserva salita netta, mentre il passaggio a testi lunghi aumenta la RSS di ~24 MiB. **Dopo la regola CF**, sono state ripetute due serie da 1.000 richieste sintetiche per motore (20 warmup per serie, 4 GiB senza swap): 0 errori/OOM, RSS massima campionata Horizon 1598,4/1602,8 MiB e spaCy 184,9/184,9 MiB. `memory.peak` non era disponibile: non sono picchi assoluti. L'immagine Horizon nella prova precedente era ~1508,7 MiB su disco, dato diverso da RSS e cgroup. 
