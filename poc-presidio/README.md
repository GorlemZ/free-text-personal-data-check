# Presidio — PoC italiano con contratto uniforme

Servizio HTTP interno: Presidio Analyzer, spaCy `it_core_news_sm` 3.8.0 e policy applicata nel servizio. Nessuna integrazione nei process applicativi, persistenza o chiamata a servizi di inferenza. Un esito `accepted` non dimostra assenza di dati personali.

## Avvio dalla root del repository

Richiede Python 3.11–3.12 e `uv`. Dipendenze e wheel italiano sono fissati in `uv.lock`.

```sh
uv sync --project poc-presidio --frozen --extra dev
uv run --project poc-presidio --frozen free-text-check
```

Bind predefinito `127.0.0.1:8000`; variabili `ANALYZER_BIND_HOST` e `ANALYZER_PORT`. Access log disabilitato. Il PoC **non autentica**: non esporlo su Internet; un bind diverso richiede rete privata e controllo di accesso esterno. Usare esclusivamente esempi sintetici.

## Contratto HTTP

Solo `GET /health/ready` e `POST /v1/analyze`, con metodo e percorso esatti: query string, trailing slash, percorsi alternativi codificati e altri metodi restituiscono `404`, senza redirect. L’entrypoint usa `ExactTargetProtocol` per conservare anche il delimitatore `?` vuoto, che lo scope ASGI standard perderebbe. Readiness `200 {"status":"ready"}` soltanto se il caricamento del modello riesce; altrimenti `503`.

```json
{"fields":[{"fieldId":"description","text":"Mario Rossi","allowedCategories":["PERSON"]}]}
```

Risposta business esattamente:

```json
{"verdict":"accepted","findings":[]}
```

Un rifiuto contiene soltanto categorie vietate: `{"verdict":"rejected","findings":[{"fieldId":"description","category":"PERSON"}]}`. Finding deduplicati e ordinati lessicograficamente per unità UTF-16, prima `fieldId`, poi categoria. Nessun testo, span, score, label nativa o versione nel body business. Gli identificatori sono restituiti: il chiamante deve usare ID tecnici, non dati personali.

Catalogo chiuso: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`. `allowedCategories` omesso o vuoto vieta tutte le categorie; duplicati ammessi. La policy deve essere scelta da un chiamante fidato, non dall'utente finale. Non è la `allow_list` di valori Presidio.

### Validazione e precedenza

1. Percorso/metodo non ammessi: `404 {"code":"not_found"}`.
2. Content-Type diverso da `application/json`: `400 {"code":"invalid_request"}`. Case, spazi esterni e parametri sono tollerati.
3. Body oltre 1 MiB: `413 {"code":"body_too_large"}`; limite inclusivo, lettura a chunk.
4. UTF-8 rigoroso, JSON senza BOM o chiavi duplicate decodificate, schema chiuso: `400`.
5. Intera richiesta validata **prima** del detector: 1–10 campi, ID univoco di 1–128 unità UTF-16, testo stringa anche vuota con massimo 50 parole separate da Unicode `White_Space`. Surrogate isolati, categorie ignote e chiavi extra sono invalidi. Non si usa `str.split()`, che tratta diversamente U+001C–U+001F.
6. Guasto detector, output nativo malformato o label sconosciuta: `503 {"code":"detector_unavailable"}`, senza risultati parziali né dettagli delle eccezioni. Un input invalido resta `400` anche con modello indisponibile.

## Semantica e limiti del motore

L'adapter filtra le categorie native note fuori catalogo (`LOCATION`, `ORGANIZATION`, `DATE_TIME`, `CRYPTO`, `IP_ADDRESS`, `MAC_ADDRESS`, `MEDICAL_LICENSE`, `IT_PASSPORT`, `URL`) **prima** della policy. Non ignora silenziosamente label nuove o risultati malformati. I documenti italiani usano le label native `IT_*`, senza promuovere documenti esteri generici.

`PHONE_NUMBER` viene conservata solo quando lo span nativo appartiene all'intero involucro numerico originale compatibile con numero italiano: mobile `3` + nove cifre o fisso `0` seguito da cifra non zero e altre 4–9 cifre; prefissi `+39`/`0039` ammessi, prefissi esteri esclusi. Non si riparte dal suffisso di un numero estero. Questo filtro non crea detection assenti e non modifica recognizer o soglie.

Configurazione NER PER/ORG/LOC, soglia `0.35`, heuristics e gate checksum originali restano invariati. Identificativi riconoscibili ma con checksum errato possono essere falsi negativi nel pilot: vanno misurati, non corretti tramite tuning. Il catalogo rappresenta il contratto, non una garanzia di copertura. Il PSL dell'email validator usa lo snapshot locale senza fetch runtime.

## Test dalla root

```sh
uv run --project poc-presidio --extra dev pytest tests/presidio
uv run --project poc-presidio --extra dev ruff check --config poc-presidio/pyproject.toml poc-presidio/src tests/presidio tests/bench/presidio tests/contract/serve-presidio.py
```

I test HTTP iniettano risultati **nativi** tramite `create_app(detect_fn=..., ready_fn=...)`, mantenendo mapping, filtro e policy reali; lo smoke usa anche il modello locale reale. Il server `tests/contract/serve-presidio.py` implementa le fixture condivise su loopback (`PORT`, `CONTRACT_UNAVAILABLE`), non è un entrypoint produttivo.

Il vecchio harness diagnostico è soltanto un'utility sotto `tests/bench/presidio/benchmark.py`, con corpus sintetico locale e otto categorie storiche. Non è incluso nel package/runtime Docker né nel confronto uniforme; i suoi aggregati non sono comparabili al pilot comune sotto `tests/evaluation`. I test dell'harness verificano struttura e conteggio degli errori, non soglie prestazionali. Nessuna valutazione prestazionale è richiesta da questa migrazione.

## Container

```sh
docker build -t free-text-check:presidio poc-presidio
```

Il contesto contiene solo il servizio: nessun `COPY bench`. Utente non privilegiato, bind loopback e access log disabilitato; rendere il servizio raggiungibile richiede bind esplicito e rete isolata. La build Docker e il pilot comparativo sono verifiche separate dai test locali. Per produzione servono pin per digest, scansione immagine, autenticazione e verifica della catena ingress/proxy/APM.
