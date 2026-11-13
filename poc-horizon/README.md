# PoC Horizon

Servizio TypeScript su Node.js 24 con `@huggingface/transformers@4.3.2`, modello `Horizon-Labs/pii-redactor-base` ONNX q8 e riconoscitori TypeScript. [Contratto HTTP comune](../tests/contract/README.md) · [Test](../tests/README.md) · [Valutazione](../tests/evaluation/README.md).

## Avvio dalla root

```sh
npm --prefix poc-horizon ci
npm --prefix poc-horizon run build
npm --prefix poc-horizon run prefetch
npm --prefix poc-horizon run smoke
npm --prefix poc-horizon start
```

`build` ripulisce `dist/` e compila tutti i sorgenti `.ts` di `src/` (incluse le CLI in `src/scripts/`), senza caricare o scaricare modelli. Eseguirlo prima di `prefetch` e `start`: questi usano rispettivamente `node dist/scripts/prefetch.js` e `node dist/index.js`. `smoke` compila e avvia `dist/scripts/smoke.js`. Importare app, router, servizi, adapter, `index`, `smoke` o `prefetch` non avvia server, inferenza o download e non configura/carica il runtime Transformers. Bind predefinito `127.0.0.1:8000`, configurabile con le sole `ANALYZER_BIND_HOST` e `ANALYZER_PORT` (conversione `Number`, anche porta `0` supportata). `index.ts` legge la configurazione una volta, costruisce un solo adapter e i tre servizi, attende il warmup e soltanto dopo ascolta, con `requestTimeout` di 10000 ms. La Promise della pipeline è lazy e condivisa per istanza dell'adapter, con retry dopo fallimento; carica soltanto file locali e pesi mancanti impediscono l'avvio. La readiness riguarda il caricamento, non l'inferenza.

## Confine HTTP e composizione

- `createApp({ analysisService, ready, onQueued? })` in `src/app.ts` restituisce un `RequestListener`: servizio e readiness sono obbligatori e separati, senza `listen` o dipendenze modello di default.
- `analysisServiceBuilder({ ruleDetectionService, modelDetectionService })` espone `analyze(fields) -> FieldAnalysis[]` asincrono. `ruleDetectionServiceBuilder` separa `collect` raw e `interpret`; `modelDetectionServiceBuilder(adapter)` delega `prepare`/`ready`/`infer` e separa `interpret`. I tipi pubblici dei servizi sono derivati con `ReturnType`, senza classi o framework DI.
- L'analisi prepara tutti i campi sequenzialmente prima di ogni regola o inferenza. Poi, per campo: collect raw regole → infer raw modello → guard condiviso che entrambi siano array → interpretazione regole → interpretazione modello → fusione → policy. Un risultato regole malformato non sopprime l'inferenza; un recognizer che lancia sì. Un errore infer non interpreta le regole raccolte. Nessun risultato parziale o fallback.
- I router riconoscono soltanto `GET /health/ready` e `POST /v1/analyze` esatti. Validazione strict JSON/schema e limite byte precedono l'ammissione. Ogni app possiede un executor FIFO indipendente: una richiesta di analisi attiva, massimo quattro incluse l'attiva; l'intera analisi e la proiezione della risposta occupano un job. Readiness fuori coda.
- `config/config.ts` centralizza limiti HTTP, opzioni e percorsi modello/manifest esistenti senza nuove variabili d'ambiente. `adapters/transformersAdapter.ts` è l'unico confine SDK, con loader tecnico iniettabile per test senza pesi. Le porte raw restituiscono `unknown`; soltanto l'interpretazione costruisce DTO validati. `model/contracts.ts` definisce DTO readonly, `Category` chiusa sulle nove voci di `model/categories.ts`, `Field.allowedCategories` obbligatorio dopo normalizzazione HTTP omissione → `[]`, span come coppia completa oppure assente (`exactOptionalPropertyTypes`). Semantica e policy sono funzioni pure. `validation/`, converter, errori e utility conservano il confine HTTP; risposte JSON con `nosniff`, senza testo o candidati.
- I test d'integrazione e l'harness contrattuale usano `tests/horizon/create-test-app.mjs`: compone i veri servizi con adapter sintetico esplicito. Il solo wrapper legacy `analyzeFields` vive negli harness, non nel runtime produttivo. Lo smoke programmatico richiede `handler` e `detectText`; la CLI compone lo stack soltanto nel main guard.

Dopo il prefetch:

```sh
docker build -t free-text-check:horizon-uniform ./poc-horizon
docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0   -p 127.0.0.1:18082:8000 free-text-check:horizon-uniform
```

Attendere `GET /health/ready`. Il Dockerfile compila TypeScript in build; il runtime contiene `dist/`, dipendenze, manifest e asset locali, non `src/` o i vecchi `scripts/`. Verifica gli asset offline con `node dist/scripts/prefetch.js --verify-only` e usa Node sotto utente non privilegiato, senza Python, test o benchmark. Smoke senza rete sull'immagine già costruita:

```sh
docker run --rm --network none free-text-check:horizon-uniform node dist/scripts/smoke.js
```

## Detection e adapter

Come [Rizzo](../poc-rizzo/README.md#pipeline-nlp-comune), Horizon usa `TokenClassificationPipeline` standard di Transformers.js, senza decoder applicativo. Le entità ricevute vengono validate e mappate nel servizio: non è un controllo dei logits dei token filtrati dalla libreria. Modelli, soglie e regole restano distinti; l'API comune non implica detection equivalente.

Soglia sperimentale `0.35`, aggregazione `simple`. La pipeline valida tutti i campi e il budget token, applica regole e modello al testo originale, converte i candidati nel catalogo comune e applica la policy per campo.

- `EMAIL` diventa `EMAIL_ADDRESS`; `PHONE` e il riconoscitore `PHONE_NUMBER` condividono la categoria business. Entrambi passano il filtro geografico italiano sull'intero candidato.
- `TAX_ID` e `BANK_ACCOUNT` non vengono promossi automaticamente a identificativi italiani o IBAN. Extra conosciuti sono esclusi prima della policy; etichette sconosciute o risultati malformati causano errore tecnico.
- `NATIONAL_ID` e `DRIVER_LICENSE` diventano documenti italiani soltanto con forma, confini Unicode e contesto italiano nei 50 caratteri precedenti, oppure valore standalone. Sono supportate CIE `AA12345AA`/`1234567AA` e patenti `AA1234567A`/variante `U1…`.
- Transformers.js restituisce `word` senza offset: **solo per i documenti**, il valore con bordi rimossi tramite `trim()` deve corrispondere a un'unica occorrenza letterale nell'originale. Nessuna normalizzazione interna. Valori ripetuti, assenti o non corrispondenti restano esclusi; gli offset eventualmente forniti sono autorevoli. Offset invalidi o `word` di tipo errato causano errore tecnico.

## Limiti del motore

- **512 token inclusi quelli speciali**; preflight con `truncation:false`. Il limite può essere superato sotto 50 parole: risposta 503, senza analisi parziale.
- Un'inferenza alla volta, fino a quattro richieste ammesse complessivamente; saturazione 503.
- CF canonico con checksum, senza omocodia; P.IVA con checksum e placeholder tutto-zero escluso; IBAN **solo IT** con modulo 97; carte di 13–19 cifre con Luhn. Il gold include checksum errati riconoscibili e IBAN esteri: queste differenze possono produrre falsi negativi.
- Carte e telefoni del modello richiedono span validi, senza ricostruzione da `word`; PERSON ed email non li richiedono. Le categorie sovrapposte restano indipendenti nella policy.

L'helper storico [fiscal-code.ts](src/fiscal-code.ts) verifica soltanto la forma plausibile ed è coperto da regressioni; la pipeline HTTP usa il riconoscitore strutturato.

## Modello e attribuzioni

[model-manifest.json](model-manifest.json) fissa revisione e dimensioni, più SHA256 degli artefatti maggiori; la build Docker verifica i file locali, mentre `npm run build` compila soltanto. La model card dichiara Apache-2.0 e attribuisce parte dei dati CC-BY-4.0 ad ai4privacy e NVIDIA: conservare gli avvisi nella redistribuzione di modello o immagine.
