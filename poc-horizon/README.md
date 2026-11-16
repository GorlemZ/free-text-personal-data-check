# PoC Horizon

Servizio TypeScript su Node.js 24 con `@huggingface/transformers@4.3.2`, modello `Horizon-Labs/pii-redactor-base` ONNX q8 e riconoscitori TypeScript. [Contratto HTTP comune](../tests/contract/README.md) · [Test](../tests/README.md) · [Valutazione](../tests/evaluation/README.md).

## Avvio dalla root

```sh
pnpm install --frozen-lockfile
pnpm --filter poc-horizon-pii-check build
pnpm --filter poc-horizon-pii-check prefetch
pnpm --filter poc-horizon-pii-check smoke
pnpm --filter poc-horizon-pii-check start
```

`build` ripulisce `dist/` e compila sorgenti e CLI senza caricare o scaricare modelli. `prefetch` e `start` richiedono prima il build; `smoke` compila ed esegue inferenza reale. Importare i moduli non avvia server, SDK o download. Bind predefinito `127.0.0.1:8000`, configurabile con `ANALYZER_BIND_HOST` e `ANALYZER_PORT` (conversione `Number`, porta `0` supportata). La composition root legge la configurazione, attende una sola inizializzazione esplicita dell'adapter e poi ascolta, con `requestTimeout` di 10000 ms. Nessuna cache lazy o retry implicito; file locali mancanti o configurazione invalida impediscono il listen. La readiness riguarda il caricamento, non l'inferenza.

## Confine HTTP e composizione

- `createApp({ analysisService, ready, concurrency? })` in `src/app.ts` restituisce un `RequestListener`: servizio e readiness sono obbligatori e separati, senza `listen` o dipendenze modello di default. Il dispatch di metodo/percorso, il parser `express.json()` limitato a 1 MiB e il fallback 404 sono montati dal package condiviso `@pagopa/detector-http`; il router riceve `req.body`, lo valida con Zod e risponde tramite `res.status(...).send(...)`.
- `src/index.ts` è il solo composition root: legge config, attende il modello, costruisce service e app e delega listen, segnali e shutdown bounded a `@pagopa/detector-http`. La porta è validata fail-fast; il modello è pronto prima dell'apertura della porta.
- `analysisServiceBuilder({ adapter, recognize?, threshold? })` espone `analyze(fields) -> readonly FieldAnalysis[]`. L'adapter è direttamente iniettato; non serve un wrapper model pass-through. Mapping, interpretazione delle regole e policy sono funzioni pure, senza framework DI.
- Ogni campo completa **budget → inferenza → mapping/soglia → regole integrative → policy** prima del successivo. Un errore impedisce ogni lavoro successivo e produce errore tecnico senza risultati parziali. Un campo tardivo fuori budget può quindi invalidare lavoro già svolto sui precedenti.
- I router riconoscono solo `GET /health/ready` e `POST /v1/analyze` esatti. Validazione JSON standard/schema e limite byte precedono l’ammissione. Ogni app possiede un limiter privato `p-limit@6.2.0`: capacità per intera richiesta, inclusa la proiezione, nessuna coda oltre il limite, saturazione 503. Health indipendente dalla capacità. Lo slot si libera solo alla conclusione reale del task, anche in errore; timeout o disconnessione del client non cancellano l’inferenza né liberano anticipatamente capacità.
- `config/config.ts` centralizza limiti HTTP, opzioni e percorsi modello/manifest e configurazione di budget e concorrenza. `adapters/transformersAdapter.ts` è l'unico confine SDK, mentre `model/modelInterpretation.ts` valida e traduce l'output raw; il catalogo business resta in `model/categories.ts`. La porta raw del modello restituisce `unknown`; il riconoscitore integrativo restituisce `ReadonlySet<Category>`. Matching, contesto e checksum restano locali al riconoscitore: nessun candidato, offset o stato di check attraversa il confine applicativo. Il servizio controlla soltanto categorie valide e fonte statica, senza ricostruire span o validare testo. `model/contracts.ts` definisce DTO readonly, `Category` chiusa sulle nove voci di `model/categories.ts`, `Field.allowedCategories` obbligatorio dopo normalizzazione HTTP omissione → `[]`, risultato con sole categorie `detected` e `denied`, senza `possible`, candidati, score o offset. Gli offset interni ai riconoscitori servono soltanto ai loro controlli locali, mai alla validazione del modello. Riconoscimento e policy sono funzioni pure; i checksum usano riduzioni senza accumulatori mutabili. `validation/`, converter, errori e utility conservano il confine HTTP; risposte JSON con `nosniff`, senza testo o candidati.
- I test d'integrazione e l'harness contrattuale usano `tests/horizon/create-test-app.mjs`: compone i veri servizi con adapter sintetico esplicito. Il solo wrapper legacy `analyzeFields` vive negli harness, non nel runtime produttivo. Lo smoke programmatico richiede `handler` e `detectText`; la CLI compone lo stack soltanto nel main guard.

Dopo il prefetch:

```sh
docker build -f poc-horizon/Dockerfile -t free-text-check:horizon-uniform .
docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0   -p 127.0.0.1:18082:8000 free-text-check:horizon-uniform
```

Attendere `GET /health/ready`. Il Dockerfile compila TypeScript in build; il runtime contiene `dist/`, dipendenze, manifest e asset locali, non `src/` o i vecchi `scripts/`. Durante la build finale un verificatore Node inline controlla dimensioni e SHA-256 degli asset e conferma l'assenza degli eseguibili Python. L'immagine usa Node sotto utente non privilegiato, senza Python, test o benchmark. Smoke senza rete sull'immagine già costruita:

```sh
docker run --rm --network none free-text-check:horizon-uniform node dist/scripts/smoke.js
```

## Detection e adapter

Come [Rizzo](../poc-rizzo/README.md#pipeline-nlp-comune), Horizon usa `TokenClassificationPipeline` standard di Transformers.js, senza decoder applicativo. Le entità ricevute vengono validate e mappate nel servizio: non è un controllo dei logits dei token filtrati dalla libreria. Modelli, soglie e regole restano distinti; l'API comune non implica detection equivalente.

Soglia sperimentale inclusiva `0.35`, aggregazione `simple`. La matrice statica `CATEGORY_SOURCES` decide la fonte **per categoria**, non per singola predizione: assenza o score basso del modello non attiva regole di recupero.

| Categoria         | Fonte esclusiva | Motivazione / mapping                                         |
| ----------------- | --------------- | ------------------------------------------------------------- |
| PERSON            | modello         | `PERSON`                                                      |
| EMAIL_ADDRESS     | modello         | `EMAIL`                                                       |
| PHONE_NUMBER      | modello         | `PHONE`; nessun veto geografico o di forma                    |
| CREDIT_CARD       | modello         | `CREDIT_CARD`; nessun veto Luhn                               |
| IT_FISCAL_CODE    | regole          | `TAX_ID` generico non prova un CF italiano                    |
| IT_VAT_CODE       | regole          | nessuna label nativa specifica P.IVA                          |
| IBAN_CODE         | regole          | `BANK_ACCOUNT` non implica IBAN; regola morfologica ISO 13616 |
| IT_IDENTITY_CARD  | regole          | `NATIONAL_ID` non prova nazionalità/formato italiano          |
| IT_DRIVER_LICENSE | regole          | `DRIVER_LICENSE` generico non prova patente italiana          |

Le label generiche documentali restano extra noti ignorati, anche quando il testo sembra italiano: la detection IT è indipendente e integrativa. Le regole documentali riconoscono CIE `AA12345AA`/`1234567AA` e patenti `AA1234567A`/variante `U1…`, con confini Unicode e contesto nei 50 caratteri precedenti oppure valore standalone. Non associano `word` o offset del modello e non richiedono un'occorrenza unica.

Il mapping tecnico controlla contenitore, label conosciuta, score finito in `[0,1]` e tipo di `word` quando presente. `word` assente/vuoto e offset assenti o malformati non bloccano la classificazione: non vengono usati né restituiti. Gli alias canonici conosciuti sono accettati solo quando la matrice assegna la categoria al modello; non trasformano categorie integrative in categorie coperte.

## Limiti del motore

- `ANALYZER_TOKEN_BUDGET`: intero positivo sicuro, default **512**, massimo 512 e comunque non oltre i limiti nativi del modello/tokenizer caricato. Un solo controllo esterno per campo, con `truncation:false`, `padding:false`, `add_special_tokens:true`. La pipeline standard tokenizza nuovamente: nessun tokenizer custom. Overflow anche sotto 50 parole: 503, senza analisi parziale.
- `ANALYZER_CONCURRENCY`: intero positivo sicuro, default **1**. Stato di scheduling interno alla libreria, non immutabilità del suo runtime: `activeCount + pendingCount` include le prenotazioni nello stesso turno sincrono di `limit(task)`, prima dei microtask. Nessun contatore applicativo e nessuna richiesta eccedente eseguita. Il limite è per istanza app/processo, non distribuito fra processi.
- CF e P.IVA richiedono una morfologia italiana riconoscibile; il placeholder P.IVA tutto-zero resta escluso. Gli IBAN seguono la morfologia internazionale ISO 13616 (15–34 caratteri alfanumerici), in forma compatta oppure nei consueti gruppi di quattro separati da un singolo spazio ASCII. I checksum restano disponibili come diagnostica interna ma **non filtrano la detection**: un identificativo riconoscibile con cifra o carattere di controllo errato resta sensibile e viene segnalato.
- Nessun controllo di forma, checksum, span o geografia può scartare una categoria coperta emessa dal modello sopra soglia. Questo può aumentare falsi positivi (inclusi telefoni esteri rispetto al gold italiano); togliere le regole sulle categorie coperte può aumentare omissioni. Nessuna equivalenza con la baseline o qualità reale è attestata dai test sintetici. Le categorie sovrapposte restano indipendenti nella policy.

Gli helper storici di sola forma CF, carte e telefoni e l'alias `italian-phone` sono rimossi: non avevano consumer runtime o CLI. La pipeline HTTP usa solo il registry di categorie integrative. I test conservano checksum e confini delle regole attive, mapping modello, policy, errori, admission e budget; non impongono più comportamenti dei recognizer ritirati.

`tests/horizon/detection-purity.test.mjs` visita tutti gli import transitivi delle entry point detection di entrambi i motori (inclusi collaboratori Rizzo iniettati e import di tipi), senza filtro sui file modificati. Verifica tramite AST assenza di `let`/`var`, riassegnazioni, incrementi e metodi mutanti noti, con controlli positivi del gate e inventario emesso. Non è una prova formale di purezza: adapter SDK, startup, HTTP/ammissione e budget restano confini esclusi esplicitamente; nessun file raggiunto dal nucleo è escluso.

## Modello e attribuzioni

[model-manifest.json](model-manifest.json) fissa revisione e dimensioni, più SHA256 degli artefatti maggiori; la build Docker verifica i file locali, mentre `pnpm --filter poc-horizon-pii-check build` compila soltanto. La model card dichiara Apache-2.0 e attribuisce parte dei dati CC-BY-4.0 ad ai4privacy e NVIDIA: conservare gli avvisi nella redistribuzione di modello o immagine.

## Confine HTTP, parsing standard e stato

Horizon usa il parser JSON standard Express con limite di **1 MiB**. Il parser
gestisce media type, buffering, decodifica e `JSON.parse`; il router riceve un valore
non fidato e `AnalyzeRequestSchema.safeParse(req.body)` applica schema chiuso,
limiti e normalizzazione dell’allowlist. JSON malformato resta 400 e il superamento
del limite resta 413. Per il chiamante M2M controllato non sono più requisiti del
boundary la decodifica UTF-8 `fatal`, il rifiuto del BOM, il draining applicativo e
la precedenza custom degli errori byte-level: il BOM iniziale è accettato e sequenze
UTF-8 invalide dentro stringhe possono essere sostituite dal decoder standard.
Routing e parser precedono schema, ammissione e inferenza; una disconnessione durante
inferenza non libera anticipatamente la capacità.

**Differenza deliberata:** `JSON.parse` standard sostituisce gli scanner custom.
Chiavi JSON duplicate (anche con escape equivalenti) usano **l’ultimo valore**;
si valida lo schema risultante. Un valore precedente scartato, anche con surrogate
isolate, non viene più ispezionato; chiavi sconosciute e valori finali invalidi
restano vietati. `fieldId` ripetuti fra campi restano invalidi; ID e testo finali
sono verificati con `isWellFormed()`. Limiti Unicode, parole, categorie e risultato
business restano invariati. Questa scelta non modifica il parser di Presidio:
l’harness condiviso dichiara le tre aspettative last-wins per i soli motori Node.

Il codice applicativo usa valori readonly, `map`/`every`, Set costruiti senza
`.add` e ordinamento non mutante. Il controllo AST copre tutti gli entrypoint
runtime e CLI e i relativi import locali; non certifica immutabilità dell’intero
processo. Stato di buffer e scheduling appartiene rispettivamente al parser Express
e a `p-limit`; stream, socket, filesystem, processo e SDK restano confini mutabili
espliciti. Gli smoke reali non sono eseguiti dai gate sintetici: nessuna prova di
qualità del modello è implicita in queste verifiche.
