# Free-text personal-data check (PoC)

Servizio HTTP **interno** per process: Presidio Analyzer come libreria, spaCy italiano `it_core_news_sm` e policy di categorie ammesse per campo applicata nel servizio. Non è integrato nei process e non blocca ancora alcuna scrittura applicativa. Il PoC non prova assenza di dati personali né idoneità produttiva.

## Avvio locale

Richiede Python 3.11, `uv` e accesso al wheel spaCy fissato in `uv.lock`.

```sh
uv sync --frozen --extra dev
uv run --frozen free-text-check
```

Di default ascolta **solo** `127.0.0.1:8000`, anche nel container. `ANALYZER_PORT` modifica la porta; `ANALYZER_BIND_HOST` consente un bind esplicito. **Questo PoC non autentica i chiamanti**: non impostare `ANALYZER_BIND_HOST=0.0.0.0` né pubblicare la porta senza una rete privata isolata e un controllo d'accesso esterno verificato. Non inviare dati personali reali. Un ambiente distribuito richiede una decisione esplicita su autenticazione, TLS/mTLS o equivalente, restrizioni d'ingresso e verifica di ingress/proxy/APM prima del deploy.

### Contratto interno

`POST /v1/analyze` con `Content-Type: application/json`, senza header di autenticazione:

```json
{"fields":[{"fieldId":"description","text":"Servizio digitale.","allowedEntityTypes":[]}]}
```

`200`: `{ "verdict":"accepted", "modelPolicyVersion":"it-spacy-sm-3.8.0-poc4-native-italian-documents", "findings":[] }`. In caso di rifiuto, `findings` contiene soltanto `{fieldId, entityType}` per categorie **non ammesse**, deduplicate e ordinate. Non include il testo, frammenti, offset o score. `allowedEntityTypes` è una policy di categorie applicata **dopo** il riconoscimento e il filtro del catalogo applicativo, non la `allow_list` di valori Presidio. Il process deve costruire una policy fidata; non inoltrare allowlist decise dal browser. Un `accepted` significa soltanto che la configurazione non ha rilevato categorie vietate sopra soglia.

- `GET /health/ready` e `POST /v1/analyze` non richiedono autenticazione; accesso limitato dal bind locale predefinito.
- `400 INVALID_ANALYZE_REQUEST` per schema, JSON, duplicati o limiti invalidi; non ritentare lo stesso payload.
- `503 ANALYZER_UNAVAILABLE` se modello o analisi falliscono; nessun risultato parziale. Il chiamante deve restare fail-closed e ritentare soltanto guasti tecnici transitori con limiti propri.
- `200 rejected` è un esito di contenuto; non ritentarlo automaticamente.

Limiti PoC: 1–16 campi, massimo 2.000 code point e 8.000 byte UTF-8 per campo, 32.768 byte per body; `fieldId` univoco nel catalogo chiuso `FIELD_IDS` in `app.py` (i dieci scenari più l'alias sperimentale `description`), per evitare che il chiamante lo usi per riflettere testo nel verdetto; testo vuoto consentito; nessuna normalizzazione implicita. Catalogo applicativo chiuso (nove categorie native Presidio): `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`. Le allowlist fuori catalogo sono rifiutate; le etichette native fuori catalogo (`LOCATION`, `ORGANIZATION`, `DATE_TIME`, ecc.) vengono ignorate, non rimappate. I candidati strutturati nativi sono convalidati sull'intero span prima della fusione con regole indipendenti: CF canonico e carattere di controllo (anche senza risultato del recognizer contestuale), partita IVA italiana con checksum, IBAN italiano con modulo 97, carta con Luhn, telefono di tutti i paesi con prefisso esplicito `+`/`00` o default `IT` senza prefisso. La validazione telefonica usa `phonenumbers==9.0.41` e `is_valid_number`, non il solo formato o lunghezza possibile: spazi ASCII, trattini e parentesi bilanciate sono ammessi, l’intero involucro numerico conservativo viene consumato prima della validazione, senza ritentare suffissi dopo prefissi malformati; confini Unicode escludono lettere, numeri, segni combinanti e underscore adiacenti. I candidati nativi telefono devono coincidere con uno span completo valido nel testo originale. I metadati non certificano assegnazione o raggiungibilità. CF con omocodia escluso; P.IVA `00000000000` esclusa come placeholder non valido pur passando il checksum, senza verifica di assegnazione. Un'etichetta nativa diversa sovrapposta non cancella una categoria valida; il filtro opera per categoria. La rilevazione non certifica l'attribuzione reale dell'identificativo. I campi vengono analizzati tutti o la chiamata fallisce. Nessuna cache e nessuna persistenza nel detector. L'API non è pubblica; il servizio non autorizza utenti finali.

Fonti API/fixture: README upstream `catamphetamine/libphonenumber-js` (parsing stretto e fixture USA), README `daviddrysdale/python-phonenumbers` (fixture UK), `phonenumbers.example_number("IT")` (fixture nazionale). Metadati di versioni diverse possono divergere: nessuna equivalenza universale implicita.

## Test e benchmark

```sh
uv run --frozen --extra dev pytest -q
uv run --frozen --extra dev ruff check src tests
uv run --frozen free-text-benchmark
```

`bench/corpus.json` contiene **solo esempi sintetici** etichettati; dieci scenari FE, divisi 5/5 tra calibrazione e valutazione. Il corpus storico non è stato modificato per questa fase. Il report CLI esporta soltanto aggregati e denominatori, mai singoli testi o risultati. Unità detector: presenza categoria per campo per le nove categorie del catalogo applicativo; unità policy: rifiuto per richiesta a campo singolo. Precision/recall `null` se il denominatore è zero. Errori tecnici sono conteggiati separatamente e non come true negative. `falseNegativeDiagnosis` distingue candidato presente sotto soglia da assenza di candidato **nelle categorie attese**. Il set è troppo piccolo per stimare prestazioni o soglie di produzione. Le categorie ammesse nel corpus sono sperimentali, non policy approvata. I test locali di policy e telefono sono stati eseguiti; nessun benchmark o Docker è stato eseguito per la modifica dei telefoni internazionali.

Il report `latencyMs` misura soltanto la chiamata detector per campo (primo campione può includere cold start); **non** misura HTTP, risorse del container o latenza end-to-end. Lo score Presidio non è una probabilità calibrata. La soglia iniziale è `0.35`; provare `free-text-benchmark --threshold 0.5` per diagnosi offline e ripetere su un corpus di valutazione indipendente prima di cambiarla nel servizio. Il modello `it_core_news_sm` v3.8.0 e le dipendenze sono fissati nel lock; verificare anche hash del wheel nel lock. Il mapping NER PER/ORG/LOC è esplicito. La presenza dei recognizer italiani `PERSON`, `EMAIL_ADDRESS`, `IT_FISCAL_CODE`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE` viene verificata al caricamento; i test HTTP iniettano finding documentali senza misurare la sensibilità reale. La dipendenza Faker usata dal vecchio generatore del corpus comparativo è stata rimossa dall'extra `dev`; non serve al servizio né al gold letterale. Un modello/built-in che non riconosce una categoria o un testo sotto soglia resta un limite da misurare, non un successo.

## Container

`docker build -t free-text-check:poc .` per la build locale. Il server nel container ascolta su `127.0.0.1` per default: non è raggiungibile attraverso la porta pubblicata dal container. Un bind di rete va configurato esplicitamente solo in ambiente isolato con un controllo d'accesso esterno verificato; non pubblicare la porta su Internet. Il Dockerfile usa utente non privilegiato e immagine Python/uv fissata per tag; per produzione servono pin per digest, scansione immagine e verifica privacy dell'intera catena. Nessun deploy è stato effettuato.
