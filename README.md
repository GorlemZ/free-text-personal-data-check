# Free-text personal-data check (PoC)

Servizio HTTP **interno** per process: Presidio Analyzer come libreria, spaCy italiano `it_core_news_sm` e policy di categorie ammesse per campo applicata nel servizio. Non è integrato nei process e non blocca ancora alcuna scrittura applicativa. Il PoC non prova assenza di dati personali né idoneità produttiva.

## Avvio locale

Richiede Python 3.11, `uv` e accesso al wheel spaCy fissato in `uv.lock`.

```sh
uv sync --frozen --extra dev
export ANALYZER_SERVICE_TOKEN='scegliere-un-segreto-per-l-ambiente-locale'
uv run --frozen free-text-check
```

Di default ascolta **solo** `127.0.0.1:8000`. `ANALYZER_PORT` modifica la porta; `ANALYZER_BIND_HOST` consente un bind esplicito per una rete privata controllata. Il token non va scritto nel repository, nei log o passato come argomento sulla riga di comando. L'avvio fallisce se è assente. Per un ambiente distribuito occorrono rete privata, gestione del segreto, TLS/mTLS o equivalente, restrizioni d'ingresso e verifica di ingress/proxy/APM; il solo token del PoC non costituisce una configurazione produttiva.

### Contratto interno

`POST /v1/analyze` con `Authorization: Bearer <token>` e `Content-Type: application/json`:

```json
{"fields":[{"fieldId":"description","text":"Servizio digitale.","allowedEntityTypes":[]}]}
```

`200`: `{ "verdict":"accepted", "modelPolicyVersion":"it-spacy-sm-3.8.0-poc1", "findings":[] }`. In caso di rifiuto, `findings` contiene soltanto `{fieldId, entityType}` per categorie **non ammesse**, deduplicate e ordinate. Non include il testo, frammenti, offset o score. `allowedEntityTypes` è una policy di categorie applicata **dopo** il riconoscimento, non la `allow_list` di valori Presidio. Il process deve costruire una policy fidata; non inoltrare allowlist decise dal browser. Un `accepted` significa soltanto che la configurazione non ha rilevato categorie vietate sopra soglia.

- `401 UNAUTHORIZED` se manca o è invalido il token, anche per `GET /health/ready`.
- `400 INVALID_ANALYZE_REQUEST` per schema, JSON, duplicati o limiti invalidi; non ritentare lo stesso payload.
- `503 ANALYZER_UNAVAILABLE` se modello o analisi falliscono; nessun risultato parziale. Il chiamante deve restare fail-closed e ritentare soltanto guasti tecnici transitori con limiti propri.
- `200 rejected` è un esito di contenuto; non ritentarlo automaticamente.

Limiti PoC: 1–16 campi, massimo 2.000 code point e 8.000 byte UTF-8 per campo, 32.768 byte per body; `fieldId` univoco nel catalogo chiuso `FIELD_IDS` in `app.py` (i dieci scenari più l'alias sperimentale `description`), per evitare che il chiamante lo usi per riflettere testo nel verdetto; testo vuoto consentito; nessuna normalizzazione implicita. Categorie supportate: vedi `get_supported_entities(language="it")`; categorie sconosciute e chiavi inattese sono rifiutate. I campi vengono analizzati tutti o la chiamata fallisce. Nessuna cache e nessuna persistenza nel detector. L'API non è pubblica; il servizio non autorizza utenti finali.

## Test e benchmark

```sh
uv run --frozen --extra dev pytest -q
uv run --frozen --extra dev ruff check src tests
uv run --frozen free-text-benchmark
```

`bench/corpus.json` contiene **solo esempi sintetici** etichettati; dieci scenari FE, divisi 5/5 tra calibrazione e valutazione. Il report CLI esporta soltanto aggregati e denominatori, mai singoli testi o risultati. Unità detector: presenza categoria per campo per otto categorie monitorate; unità policy: rifiuto per richiesta a campo singolo. Precision/recall `null` se il denominatore è zero. Errori tecnici sono conteggiati separatamente e non come true negative. `falseNegativeDiagnosis` distingue candidato presente sotto soglia da assenza di candidato **nelle categorie attese**. Il set è troppo piccolo per stimare prestazioni o soglie di produzione. Le categorie ammesse nel corpus sono sperimentali, non policy approvata.

Il report `latencyMs` misura soltanto la chiamata detector per campo (primo campione può includere cold start); **non** misura HTTP, risorse del container o latenza end-to-end. Lo score Presidio non è una probabilità calibrata. La soglia iniziale è `0.35`; provare `free-text-benchmark --threshold 0.5` per diagnosi offline e ripetere su un corpus di valutazione indipendente prima di cambiarla nel servizio. Il modello `it_core_news_sm` v3.8.0 e le dipendenze sono fissati nel lock; verificare anche hash del wheel nel lock. Il mapping NER PER/ORG/LOC è esplicito. La presenza dei recognizer `PERSON`, `EMAIL_ADDRESS`, `IT_FISCAL_CODE` viene verificata al caricamento; i test esercitano positivi sintetici reali. Un modello/built-in che non riconosce una categoria o un testo sotto soglia resta un limite da misurare, non un successo.

## Container

`docker build -t free-text-check:poc .` e avvio solo su rete interna controllata, passando `ANALYZER_SERVICE_TOKEN` mediante secret manager (mai nel Dockerfile). Il Dockerfile usa utente non privilegiato e immagine Python/uv fissata per tag; per produzione servono pin per digest, scansione immagine e verifica privacy dell'intera catena. Il server nel container ascolta su `0.0.0.0`; non pubblicare la porta su Internet. Nessun deploy è stato effettuato.
