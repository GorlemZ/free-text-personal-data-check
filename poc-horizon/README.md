# PoC Horizon + Transformers.js

Detector di testo libero italiano eseguito in Node.js con `@huggingface/transformers@4.3.2`, il modello `Horizon-Labs/pii-redactor-base` e recognizer locali per CF, P.IVA, IBAN IT, carta di credito e telefono IT (commit del modello `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`, licenza Apache-2.0 dichiarata nella model card). La model card attribuisce parte dei dati di addestramento CC-BY-4.0 ad ai4privacy e NVIDIA: conservarne l'avviso in caso di ridistribuzione del modello o dell'immagine. **Non inviare dati personali reali né esporre la porta pubblicamente.** Per le prove, **usa soltanto dati sintetici.**

## Preparazione e avvio

I moduli TypeScript `.mts` vengono compilati in `dist/` con `npm run build`; `npm start`, test, benchmark e smoke compilano prima dell'esecuzione locale. L'immagine Docker usa un builder TypeScript e copia solo l'output compilato nella fase runtime, dove il comando avvia direttamente `node src/server.mjs` senza `tsc` né Python.

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

`200`: `{"verdict":"accepted","modelPolicyVersion":"horizon-pii-redactor-base-q8-ef0eff8e-poc4-seven-it-checksum-union","findings":[]}` oppure `rejected` con soli `{fieldId,entityType}` ordinati e deduplicati. `400 INVALID_ANALYZE_REQUEST` per schema, chiavi duplicate, limiti o categorie sconosciute; `503 ANALYZER_UNAVAILABLE` su errore di modello, saturazione della coda o input oltre il budget token. `GET /health/ready` restituisce `{"status":"ready"}` dopo il caricamento. Mai testo, frammenti, offset, score o messaggi d'eccezione nelle risposte. Come nel PoC spaCy: 1–16 campi, 2.000 code point/8.000 byte UTF-8 per campo, 32.768 byte per body, `fieldId` nel catalogo chiuso, allowlist di categorie specificata da chiamante **fidato**. 1 inferenza alla volta e al massimo 4 richieste in coda; non equivale a concorrenza del modello. `accepted` significa soltanto nessuna categoria del catalogo applicativo vietata rilevata sopra soglia o dai recognizer con controlli validi.

La pipeline JS troncherebbe implicitamente il testo al massimo del tokenizer (8.192 token per questo modello). Per contenere il picco RAM e non analizzare soltanto il prefisso, questa PoC **rifiuta fail-closed** i campi oltre **512 token inclusi i token speciali**, anche se rispettano i limiti di caratteri. Non esegue chunking; questa differenza rispetto a spaCy va mantenuta visibile. La soglia sperimentale è 0,35 sullo score medio dell'aggregazione `simple`; il percorso che valida categorie strutturate richiede gli offset quando disponibili, non li ricostruisce da `word` né attraversa finestre. Se l'adapter non restituisce offset per una predizione strutturata, quella predizione non viene usata per un finding.

### Categorie

La mappatura di tutte le 29 etichette BIO Horizon è in `src/categories.mjs`, mentre il catalogo applicativo di sette categorie è in `src/analysis/contracts.mts`: `PERSON`, `EMAIL_ADDRESS`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `PHONE_NUMBER`. Il chiamante può usare solo queste categorie nell'allowlist. Le etichette native note fuori catalogo (per esempio `DATE`, `NATIONAL_ID`, `ORGANIZATION`, `LOCATION`, `IP_ADDRESS`, `URL`) vengono ignorate **prima** della policy; una nuova etichetta nativa sconosciuta rimane un errore tecnico fail-closed. `TAX_ID` resta un codice fiscale *generico*, non CF/P.IVA italiano, e `BANK_ACCOUNT` resta un conto *generico*, non IBAN: entrambi sono fuori catalogo e non vengono rimappati. `EMAIL→EMAIL_ADDRESS` e `PHONE→PHONE_NUMBER` restano mappature native; la seconda richiede un intervallo originale verificabile nel formato IT. L'eventuale compresenza di categorie valide nel catalogo non viene soppressa per sovrapposizione.

Il recognizer CF richiede forma canonica di 16 caratteri e carattere di controllo corretto (senza omocodia né verifica di assegnazione). La P.IVA richiede 11 cifre, prefisso `IT` facoltativo e checksum italiano. L'IBAN richiede `IT`, 27 caratteri e modulo 97; sono ammessi spazi ASCII tra caratteri, non altri separatori. La carta richiede 13–19 cifre e Luhn; il telefono accetta numero nazionale mobile `3` + nove cifre o fisso `0` + 5–10 cifre, anche con prefisso `+39`/`0039`, non prefissi esteri. Queste verifiche sono strutturali, non comprovano titolarità, assegnazione o raggiungibilità. I confini dei token includono lettere, segni combinanti, numeri Unicode e `_`. I recognizer producono intervalli UTF-16 nell'originale e `check: failed` per una forma riconosciuta ma non valida: quest'ultima non diventa detection. Anche `CREDIT_CARD` e `PHONE_NUMBER` emessi dal modello richiedono un intervallo valido nell'originale; una predizione senza intervallo non basta. Preflight token per **tutti** i campi prima dei recognizer, poi inferenza obbligatoria sul testo originale e unione delle sole categorie valide. Un modello fallito o una label sconosciuta impedisce qualsiasi risultato parziale.

La PoC Horizon **non è un sostituto drop-in** del servizio Presidio. I corpus e i risultati storici del precedente criterio di plausibilità (incluse fixture CF senza checksum) restano invariati per tracciabilità e **non** misurano la policy attuale: occorrerà una nuova annotazione/valutazione prima di confrontare precisione e recall. Né quei corpus sintetici né le nuove fixture attestano copertura su dati reali.

## Fusione recognizer e modello — policy corrente (non ancora eseguita in questa sessione)

La pipeline condivide `analyzeFields` fra HTTP e benchmark: preflight di tutti i campi, scansione delle regole sul testo originale, inferenza obbligatoria per ciascun campo, controllo del candidato, filtro delle sette categorie e infine sottrazione dell'allowlist del campo. `check: failed` resta solo una diagnostica interna, non un finding. I risultati sono deduplicati per campo/categoria. Il modello e la regola possono co-emettere categorie diverse sullo stesso intervallo: consentire una delle due non consente automaticamente l'altra. Per categorie strutturate, una predizione del modello senza span o con contenuto non valido non produce finding; `PERSON` e `EMAIL_ADDRESS` non richiedono span. Errori tecnici restano 503 senza findings parziali. Il formato HTTP non cambia; `MODEL_POLICY_VERSION` identifica il cambio di criterio.

`src/fiscal-code.mjs` è l'helper **storico** di forma plausibile, non usato dall'analisi HTTP/benchmark. `dist/` viene generato da `src/*.mts` durante il build: modificare solo `dist/` non cambia la sorgente. I test nuovi sono stati soltanto scritti; non è stata eseguita alcuna verifica, né è stato aggiornato il corpus storico.

## Misure di memoria

`node bench/container-memory.mjs free-text-check:horizon-poc 2 1000 4g` esegue due container nuovi con limite fisso 4 GiB, 20 richieste di warmup e 1.000 testi sintetici nuovi per serie: ogni richiesta contiene 16–40 pseudo-parole inedite, 4 client nell'ultimo 10% (l'inferenza resta seriale). Replica con `free-text-check:spacy-poc`. Riporta RSS PID 1, cgroup `memory.current`, `anon`, `file`, picco/eventi se disponibili, latenza e errori; `memory.current` comprende file-cache e non equivale a RSS. Un watchdog campiona ogni 25 richieste e interrompe il carico oltre l'80% del limite, senza usare OOM come cleanup. Criterio **indicativo**: tra checkpoint 500 e 1000 RSS e anon non salgono oltre 20% della baseline al 500, nessun errore/OOM e uso cgroup finale sotto il 75% del limite. In container con `memory.peak` assente si riportano soltanto massimi campionati: non sono massimi assoluti. Gli stessi limiti di carico, di hardware e di durata impediscono di garantire stabilità indefinita o un sizing di produzione.

## Risultati

Le misure storiche (prima dell'allineamento Phase 2; **non ripetute qui**) sono nel [progress del PoC](../.hermes/plans/poc-horizon-comparison/progress.md), con condizioni, anomalie e report distinti. **Prima della regola CF**, due serie da 1.000 richieste sintetiche per motore hanno concluso senza errori/OOM a 4 GiB; RSS massima Horizon *campionata* ~1602,5 MiB. Tra 500 e 750 richieste a lunghezza media non si osserva salita netta, mentre il passaggio a testi lunghi aumenta la RSS di ~24 MiB. **Dopo la regola CF**, sono state ripetute due serie da 1.000 richieste sintetiche per motore (20 warmup per serie, 4 GiB senza swap): 0 errori/OOM, RSS massima campionata Horizon 1598,4/1602,8 MiB e spaCy 184,9/184,9 MiB. `memory.peak` non era disponibile: non sono picchi assoluti. L'immagine Horizon nella prova precedente era ~1508,7 MiB su disco, dato diverso da RSS e cgroup.
