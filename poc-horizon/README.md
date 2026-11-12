# PoC Horizon + Transformers.js

Servizio Node.js 24 con `@huggingface/transformers@4.3.2`, modello `Horizon-Labs/pii-redactor-base` ONNX q8 e recognizer locali. Il modello resta alla revisione `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`; soglia sperimentale 0,35 e aggregazione `simple` invariate. Nessun runtime Python, chiamata a inferenza remota o download su richiesta.

**Solo dati sintetici e porta su loopback.** È una PoC senza autenticazione, non un sistema che certifica l'assenza di dati personali. La allowlist deve provenire da un chiamante fidato.

## Installazione, build e verifiche

Dalla root del repository:

```sh
npm --prefix poc-horizon ci --no-audit --no-fund
npm --prefix poc-horizon run build
npm --prefix poc-horizon run typecheck
npm --prefix poc-horizon test
python3 tests/contract/run.py --engine horizon
```

I test sono in `tests/horizon/`; le utility benchmark e le relative fixture sono in `tests/bench/horizon/`. I moduli `.mts` vengono compilati in `poc-horizon/dist/`. Test e build non richiedono i pesi: i test HTTP sostituiscono l'output nativo **prima** di mapping, filtri e policy. Il testserver condiviso `tests/contract/serve-horizon.mjs` usa gli stessi handler, adapter e recognizer del servizio.

Per l'inferenza reale, separatamente:

```sh
npm --prefix poc-horizon run prefetch
npm --prefix poc-horizon run smoke
npm --prefix poc-horizon start
# Default: 127.0.0.1:8000
```

`start` compila prima di avviare il servizio. `ANALYZER_BIND_HOST` e `ANALYZER_PORT` configurano bind e porta. Il modello è istanziato una volta per processo, con `allowRemoteModels=false`, percorso locale fisso e `local_files_only=true`; file mancanti fanno fallire startup/readiness, senza fallback fp32. Un processo che fallisce prima del bind non espone readiness.

Il Dockerfile usa Node 24, build TypeScript separata e avvia direttamente `node src/server.mjs` sotto utente non privilegiato. Non copia test o benchmark nel runtime e non avvia `tsc` o Python. I pesi, esclusi da Git, devono essere presenti nel contesto `poc-horizon/models/`:

```sh
docker build -t free-text-check:horizon-poc poc-horizon
docker run --rm --network none --memory=4g --memory-swap=4g \
  free-text-check:horizon-poc node scripts/smoke.mjs
```

`model-manifest.json` fissa revisione, dimensioni e SHA256 degli artefatti maggiori; gli altri file sono vincolati a revisione e dimensione. La build verifica gli artefatti locali. Lo smoke verifica esecuzione, API e rifiuto del token overflow; registra la detection email in coda senza trasformare un falso negativo del modello in un quality gate.

## API e policy

Il [contratto comune autorevole](../tests/contract/README.md) definisce schema, errori, precedenza e fixture condivise.

```json
{"fields":[{"fieldId":"descrizione","text":"Servizio digitale.","allowedCategories":[]}]}
```

- `GET /health/ready`; `POST /v1/analyze` esatti, senza query o slash aggiuntivi.
- 1–10 campi; ID univoci di 1–128 unità UTF-16; testo anche vuoto, massimo 50 parole separate da Unicode `White_Space`; body massimo 1 MiB UTF-8 rigoroso.
- JSON a schema chiuso, chiavi duplicate vietate anche dopo decodifica degli escape, surrogate isolate rifiutate in tutte le stringhe.
- `allowedCategories` omesso o vuoto vieta tutto; duplicati innocui; categorie sconosciute causano 400.
- Risposta 200 esattamente `{verdict, findings:[{fieldId, category}]}`. Finding vietati deduplicati e ordinati lessicograficamente per unità UTF-16, non per locale. Nessun testo, score, span, etichetta nativa o versione nella risposta business.
- Errori senza esito parziale: 404 `not_found`, 400 `invalid_request`, 413 `body_too_large`, 503 `detector_unavailable`. Validazione completa prima del detector; Content-Type prima della dimensione; dimensione prima di JSON/schema.

### Adapter semantico nel servizio

Catalogo chiuso: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`.

`src/categories.mjs` riconosce le 29 label Horizon note e gli alias business espliciti:

- `EMAIL` → `EMAIL_ADDRESS`; `PHONE` e `PHONE_NUMBER` → `PHONE_NUMBER`. Una sola allowlist business esenta entrambi i produttori telefonici.
- `PERSON` e categorie strutturate business mantengono il proprio nome. `TAX_ID` non diventa CF/P.IVA e `BANK_ACCOUNT` non diventa IBAN.
- `NATIONAL_ID` → `IT_IDENTITY_CARD` e `DRIVER_LICENSE` → `IT_DRIVER_LICENSE` **solo** se il valore associato al testo originale ha forma italiana, confini di token validi e contesto italiano nei 50 caratteri precedenti, oppure è l'intero valore standalone. Sono ammesse CIE `AA12345AA` / `1234567AA` e forme patente `AA1234567A` / variante `U1…`. Transformers.js 4.3.2 con aggregazione `simple` emette `{entity_group, score, word}` senza offset: **solo per i documenti**, quando entrambi gli offset mancano, si applica `trim()` ai soli bordi di `word` e si richiede una stringa non vuota presente come sottostringa contigua, letterale e univoca nell'originale. Restano obbligatori forma, confini Unicode e contesto/standalone. Non si normalizzano mai maiuscole/minuscole o spazi interni, né si cercano identificativi generici. Ripetizioni (anche in contesti diversi o dentro altri token), `word` assente/vuota o non corrispondente non producono finding documentali. Gli offset forniti restano autorevoli: nessun fallback a `word` se lo span non supera i controlli; offset parziali/invalidi e `word` presente ma non stringa causano 503.
- Telefoni sia da regola sia da modello passano il filtro geografico IT dell'adapter, oltre ai controlli preesistenti sull'intero involucro numerico. Il recognizer sottostante conserva i metadati internazionali; il filtro business esclude telefoni esteri, senza ricercare un suffisso italiano dentro un numero estero.
- Extra nativi **conosciuti** (`LOCATION`, `DATE`, `LICENSE_NUMBER`, ecc.) sono esclusi prima della policy, anche insieme a categorie consentite/vietate. Label realmente sconosciute e output malformati causano 503, anche sotto soglia o fra gli extra; non diventano mai `accepted` per semplice esclusione.

La pipeline `analyzeFields`, condivisa da servizio e utility di benchmark, esegue il preflight di tutti i campi, esegue regole e modello sul testo originale, valida e proietta i candidati, quindi applica la allowlist per campo. Le categorie sovrapposte restano indipendenti: consentire un CF non consente un `PERSON` co-emesso.

## Limiti deliberatamente conservati

- **512 token inclusi quelli speciali**, con tokenizzazione `truncation:false`. Il limite tecnico può essere superato sotto 50 parole e produce 503; nessun troncamento, chunking o esito parziale. Un errore nel preflight di un campo successivo impedisce ogni regola/inferenza della richiesta.
- Un'inferenza alla volta, massimo quattro richieste ammesse inclusa quella in esecuzione. Saturazione → 503; non è una misura di capacità produttiva.
- CF canonico con checksum, senza omocodia; P.IVA con checksum e placeholder tutto-zero escluso; IBAN locale **solo IT**, 27 caratteri e modulo 97; carte 13–19 cifre con Luhn. I confini escludono lettere, numeri, segni combinanti Unicode e underscore adiacenti. I recognizer e checksum non sono stati adattati al gold.
- Carte e telefoni dal modello richiedono uno span valido nell'originale; non si ricostruiscono span da `word`. `PERSON` ed email non richiedono span. Validità strutturale/metadati non implica assegnazione, titolarità o raggiungibilità.
- Il gold comune ha portata internazionale per email, IBAN e carte e considera positivi identificativi riconoscibili con checksum errato. La copertura IBAN limitata a IT e i checksum gate di Horizon possono quindi produrre **falsi negativi da misurare**, non da correggere nel runner o nascondere con quality gate.

`src/fiscal-code.mjs` è un helper storico di forma plausibile, coperto da test ma non usato dalla pipeline HTTP. Le forme telefoniche sintetiche dei test derivano dagli esempi di libphonenumber; non attestano assegnazione o raggiungibilità.

## Valutazione e utility legacy

Il confronto autorevole dei tre motori è in `tests/evaluation/`, separato dai test di contratto. Il corpus in `tests/bench/horizon/` è una fixture sintetica legacy per regressioni del codice benchmark, non un secondo pilot né prova di qualità attuale. `npm --prefix poc-horizon run bench` rimane una utility locale con inferenza reale, non un gate comparativo.

`tests/bench/horizon/contract-http.mjs` verifica forma, policy e errori di immagini già costruite senza imporre precisione/recall. `tests/bench/horizon/container-memory.mjs` conserva l'utility di carico; le richieste ora rispettano 50 parole. Misure memoria, performance e concorrenza non fanno parte di questa migrazione, e i vecchi risultati non sono confrontabili automaticamente con il nuovo contratto.

La model card dichiara Apache-2.0 e attribuisce parte dei dati di addestramento CC-BY-4.0 ad ai4privacy e NVIDIA: conservare l'avviso quando si ridistribuiscono modello o immagine.
