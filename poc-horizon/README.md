# PoC Horizon

Servizio Node.js 24 con `@huggingface/transformers@4.3.2`, modello `Horizon-Labs/pii-redactor-base` ONNX q8 e riconoscitori TypeScript. [Contratto HTTP comune](../tests/contract/README.md) · [Test](../tests/README.md) · [Valutazione](../tests/evaluation/README.md).

## Avvio dalla root

```sh
npm --prefix poc-horizon ci
npm --prefix poc-horizon run prefetch
npm --prefix poc-horizon run smoke
npm --prefix poc-horizon start
```

`smoke` e `start` compilano i moduli `.mts` in `dist/`. Bind predefinito `127.0.0.1:8000`, configurabile con `ANALYZER_BIND_HOST` e `ANALYZER_PORT`. Il modello viene caricato una volta per processo, solo da file locali; pesi mancanti impediscono l'avvio. La readiness riguarda il caricamento, lo smoke esercita l'inferenza e il limite token.

Dopo il prefetch:

```sh
docker build -t free-text-check:horizon-uniform ./poc-horizon
docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0   -p 127.0.0.1:18082:8000 free-text-check:horizon-uniform
```

Attendere `GET /health/ready`. Il Dockerfile compila TypeScript in build; il runtime usa Node sotto utente non privilegiato, senza Python, test o benchmark. Smoke senza rete sull'immagine già costruita:

```sh
docker run --rm --network none free-text-check:horizon-uniform node scripts/smoke.mjs
```

## Detection e adapter

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

L'helper storico [fiscal-code.mjs](src/fiscal-code.mjs) verifica soltanto la forma plausibile ed è coperto da regressioni; la pipeline HTTP usa il riconoscitore strutturato.

## Modello e attribuzioni

[model-manifest.json](model-manifest.json) fissa revisione e dimensioni, più SHA256 degli artefatti maggiori; la build verifica i file locali. La model card dichiara Apache-2.0 e attribuisce parte dei dati CC-BY-4.0 ad ai4privacy e NVIDIA: conservare gli avvisi nella redistribuzione di modello o immagine.
