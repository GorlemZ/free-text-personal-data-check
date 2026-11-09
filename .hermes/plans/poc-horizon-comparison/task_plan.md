# Piano implementativo — confronto PoC spaCy e Horizon

## Goal
Confrontare due servizi autonomi per il rilevamento di dati personali in testi liberi: preservare il PoC Presidio/spaCy in `poc-spacy/`, realizzare il PoC Transformers.js/Horizon in `poc-horizon/` e valutarne contratto, copertura, memoria e limiti con input sintetici. Nessuna integrazione nel monorepo applicativo è autorizzata da questo piano.

## Stato prima della pubblicazione (2026-11-04)
- **Fasi 1–7 completate localmente**; Phase 9 (indagine prestazionale read-only) completata come esplorazione. Al termine delle misure, `main` conteneva i commit locali `8c6542e` (CF) e `99e74cf` (confronto), due commit avanti a `origin/main`; non erano ancora stati pubblicati. Il fix finale del media type è stato committato senza quarta review indipendente, per scelta esplicita dell'utente. Non confondere le prove storiche con i check correnti.
- **Decisione di integrazione: sospesa.** La regex emette `IT_FISCAL_CODE`, ma Horizon può ancora restituire categorie NER errate. Dopo il CF, due nuove serie di memoria per motore non attestano stabilità indefinita. La regolazione ONNX a 2 thread è stata provata solo in scratch/container temporanei: il detector nel repository usa ancora il default. Nessun servizio o container di prova residuo.
- Le evidenze dettagliate e la cronologia sono accessibili nel PWF: `.hermes/plans/poc-horizon-comparison/findings.md` e `.hermes/plans/poc-horizon-comparison/progress.md` (alias delle note storiche).

## Stato di condivisione (2026-11-09)
- La PR #2 è stata integrata in `main`. Il branch `docs/infra-business-evaluation-guide` parte dal nuovo `origin/main` e non modifica la logica dei detector.
- La condivisione con Infra e Business richiede istruzioni distinte per valutazione tecnica e correttezza funzionale, motivazione API vs libreria e test navigabili. Non implica autorizzazione all'integrazione del PoC.

## Current Phase
Phase 10 — guida Infra/Business e prova Docker a quota 2 CPU completate, review indipendente finale PASS; l'utente ha autorizzato la pubblicazione diretta su `main`. Phase 8 — decisioni di policy, risorse e integrazione ancora sospese.

## Phases
### Phase 1: Ricognizione
- [x] Verificati software Presidio/spaCy, contratto HTTP, corpus sintetico e artefatti Horizon.
- [x] Distinte dimensione immagine Docker, RSS e memoria cgroup.
- **Status:** complete

### Phase 2: Piano e review rapide
- [x] Piano in `.hermes/plans/`, appunti in `.hermes/notes/`; review indipendenti su fattibilità/contratto e misurazioni Docker incorporate.
- **Status:** complete

### Phase 3: Due PoC autonomi
- [x] Software Python storico spostato in `poc-spacy/` senza modificarne la logica.
- [x] `poc-horizon/`: `@huggingface/transformers@4.3.2`, `Horizon-Labs/pii-redactor-base` al commit `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`, ONNX q8 preparato e verificato prima del build, incluso nell'immagine; inferenza offline, un solo caricamento per processo, nessun download o fallback fp32 durante le richieste.
- [x] API comune verificata con 6 controlli HTTP su entrambe le immagini; input oltre 512 token respinti senza troncamento, errori tecnici fail-closed, categorie non equivalenti esplicitate. Horizon serializza l'inferenza e limita la coda; il contratto pubblico non include testo, span, offset o score.
- [x] Smoke del modello su dati sintetici in host e container senza rete; 7 test Node e 18 test Python passati, Ruff check/format passati.
- **Status:** complete

### Phase 4: Benchmark e memoria
- [x] Benchmark sulle stesse 10 voci sintetiche, separando categorie realmente comparabili da categorie native/non supportate. Campione insufficiente per stimare prestazioni in produzione.
- [x] Due serie indipendenti per motore, 1.000 richieste sintetiche nuove per serie dopo warmup, container nuovo per serie, limite sperimentale 4 GiB senza swap, 4 client nel tratto finale (non equivalgono a 4 inferenze parallele). Zero errori e zero OOM nelle serie definitive.
- [x] RSS massima **campionata**: Horizon 1.602,5 MiB; spaCy 185,0 MiB. Immagini Docker: Horizon ~1.508,7 MiB; spaCy ~808,4 MiB (dimensione su disco, non RAM). `memory.peak` non disponibile; heap V8 non misurata separatamente. Horizon ha mostrato circa +23–24 MiB di RSS fra 500 e 1.000 richieste con passaggio a testi lunghi; spaCy circa +4,3–4,4 MiB nello stesso intervallo. `indicativePlateau` è solo un indicatore sulle serie finite, non prova di un tetto permanente della memoria/cache né di sicurezza a 256 MiB.
- [x] Ripetizione **dopo il CF**, con immagini ricostruite: 2×1.000 richieste sintetiche per motore, 20 warmup per serie, 0 errori e 0 OOM. RSS massima campionata spaCy 184,9 MiB in entrambe le serie; Horizon 1.598,4 / 1.602,8 MiB. I percentili dello script memoria includono erroneamente le 20 richieste warmup: non usarli come latenza post-avvio; i percentili warm/corpus del runner HTTP escludono la prima richiesta dopo readiness. Il primo tentativo lungo Horizon è scaduto nel tool ed è stato ripetuto da zero dopo rimozione del container residuo.
- **Status:** complete (per il protocollo finito)

### Phase 5: Review e documentazione del PoC
- [x] Review avversariale dell'implementazione; corretti decoding UTF-8, rendicontazione delle interruzioni Docker e comparabilità dei benchmark. README, risultati e limiti documentati; nessuna integrazione applicativa.
- [x] Prova manuale locale e diagnosi sintetica del nuovo rilievo funzionale registrate nelle note. Servizio locale fermato su richiesta.
- **Status:** complete

### Phase 6: Riconoscimento sintattico del codice fiscale nel PoC Horizon
- [x] RED: test HTTP sintetico senza riconoscimento CF fallito come atteso; cambio versione policy fallito come atteso; test benchmark CF fallito come atteso. Aggiunti test mirati HTTP/unitari per casi validi/quasi-validi, confini, allowlist, categoria nativa co-emessa ed errore al secondo campo.
- [x] GREEN: recognizer Node a regex sul formato canonico di 16 caratteri ASCII: 6 lettere, 2 cifre, mese `ABCDEHLMPRST`, giorno `01–31` o `41–71` (senza controllo del calendario/mese), lettera e 3 cifre per comune/stato, lettera finale. Maiuscole e minuscole ammesse; match solo se non adiacente a lettere, segni combinanti, numeri Unicode o `_` (niente sottostringhe in token più lunghi). Omocodia, checksum, dati anagrafici ed esistenza del codice catastale fuori scope. Il recognizer si unisce alle label dopo inferenza riuscita, senza sopprimere quelle native. Benchmark con stessa funzione di aggregazione.
- [x] Versione policy `poc2` e README aggiornati; 16 test Node, smoke HTTP con modello reale su host e container, benchmark 10 esempi e contratto HTTP 6/6 per immagine passati. La prima review indipendente del diff ha individuato il confine Unicode incompleto; corretto con test RED e nuovi check GREEN. Seconda review indipendente: PASS, nessun blocker/high/medium residuo. Nessuna modifica al PoC spaCy, nessun commit/push.
- **Status:** complete (implementazione CF locale; non implica gate funzionale/integrazione)

### Phase 7: Confronto condiviso riproducibile, solo PoC
- [x] Corpus `comparison/corpus.json`, una voce = un campo HTTP con `id` sintetico univoco, `fieldId` del catalogo, `text`, `allowedEntityTypes`, `expectedEntities` (tassonomia Presidio) e `expectedVerdict` annotato indipendentemente. Set chiuso di 18 categorie effettivamente caricate: `PERSON`, `ORGANIZATION`, `LOCATION`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IP_ADDRESS`, `MAC_ADDRESS`, `URL`, `IT_FISCAL_CODE`, `IT_DRIVER_LICENSE`, `IT_IDENTITY_CARD`, `IT_PASSPORT`, `IT_VAT_CODE`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, `MEDICAL_LICENSE`. Matrice di copertura nel README di confronto: positivo e negativo/quasi valido per ciascuna categoria oppure motivazione esplicita dell'assenza; esempi tutti sintetici e annotati indipendentemente dalle risposte. CF sintatticamente plausibile con checksum non verificato è positivo nel confronto di forma, ma la divergenza di Presidio con checksum è annotata, non occultata. Le fixture documento/DEA sono illustrative, non prove di validità ufficiale; overlap delle regex da diagnosticare.
- [x] TDD `comparison/*.test.mjs` prima di implementare il modulo: schema corpus chiuso e report senza testo/span/score. Poiché l'API espone solo categorie **vietate**, ogni campione usa due chiamate: una detector probe con `allowedEntityTypes:[]` per TP/FP/FN/TN e una policy probe con l'allowlist annotata per il verdetto; nessuna categoria permessa viene dedotta come assente. TP/FP/FN/TN per coppia campione×categoria **supportata** (non su allowlist), verdetti corretti/FP/FN per campione sulla `expectedVerdict` indipendente. Le 8 categorie non equivalenti Horizon (`IT_DRIVER_LICENSE`, `IT_IDENTITY_CARD`, `IT_PASSPORT`, `IT_VAT_CODE`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, `MEDICAL_LICENSE`) sono `unsupported`, **non FN**. Label native extra Horizon non contribuiscono alla confusion matrix a 18 ma restano nel verdetto e nella diagnosi `extraLabels`; una label extra può creare un falso rifiuto anche se la categoria attesa è rilevata. Errori tecnici/HTTP in una delle due probe escludono il campione da entrambi i denominatori; attempted/completed/errors per engine e categoria. I singoli FP/FN non bloccano il run; hard fail per schema, sicurezza, contratto e minimi neutro/e-mail/CF Horizon.
- [x] Runner `node comparison/run.mjs` usa solo immagini `free-text-check:spacy-poc` e `free-text-check:horizon-poc` costruite da `./poc-spacy` e `./poc-horizon`, controllate con `docker image inspect`. Container nuovi, `--memory=4g --memory-swap=4g --cpus=2`, porta host casuale **127.0.0.1** (bridge Docker richiesto per pubblicare; modelli offline configurati nei servizi, nessun download in request), readiness entro 120s e timeout richiesta per-field 30s / bulk 120s, cleanup in `finally` e segnali gestibili `SIGINT`/`SIGTERM`. Non stampare body, testo, span, score né eccezioni grezze; solo codici e diagnostiche per ID/categoria. Nessun accesso a dati reali o credenziali. Versioni policy in output.
- [x] Prove HTTP: `200` esattamente `verdict,modelPolicyVersion,findings`; `findings` ordinati/unici, solo `fieldId` nel catalogo e `entityType` noto, mai testo/span/score; `400`/`503` solo `{code}` generico, senza verdetto/parziali. Verificare 400 per ID duplicati e body oversized/UTF-8 malformato; il payload da 17 campi con duplicati è un rifiuto combinato, **non** prova isolata del limite 16 (catalogo di soli 11 ID). 503 nel secondo campo e label Horizon ignota con handler a inferenza iniettata (non simulare queste condizioni con i container reali). `>512` token 503 specifico Horizon. Bulk = **una** richiesta di 11 campi distinti, misurata a parte dal corpus a campo singolo; nessun massimo di 16 univoci possibile con l'attuale catalogo di 11. Cold latency: prima richiesta dopo readiness (startup escluso); warm: richieste successive con N/p50/p95 in ms; burst concorrente con N/completed/errori/p50/p95, senza SLA. Prova deterministica della coda a 4 slot con quattro inferenze iniettate e bloccate, quinta 503, poi rilascio e nessun parziale. Burst dei container reali solo osservazionale, non richiedere un conteggio prefissato di 503 per Horizon o inferenza parallela per spaCy.
- [x] Baseline: `npm test` e `npm run smoke` Horizon, `uv run --frozen --extra dev pytest -q` e Ruff spaCy, runner Docker HTTP esistente, nuova suite e runner reale; review indipendente del diff limitata a tre iterazioni (terza CHANGES REQUESTED sul media type, fix successivo verificato localmente ma **non** revisionato indipendentemente per scelta esplicita dell'utente). Commit locali separati `8c6542e` (CF) e `99e74cf` (Phase 7) su `main`; nessun push. Nessuna modifica a `poc-spacy/` o integrazione nel monorepo applicativo.
- **Status:** complete (localmente; eccezione esplicita alla quarta review del fix media type)

### Phase 8: Decisioni successive, non autorizzate ora
- [ ] Definire con gli stakeholder le categorie vietate, la semantica delle motivazioni e il criterio di accettazione; `accepted` significa soltanto nessuna categoria vietata rilevata sopra soglia, non assenza di dati personali.
- [ ] Valutare i risultati FP/FN/etichette extra della Phase 7 prima di modificare altre categorie o stabilire eventuali regole di sovrapposizione; non attribuire una label `DRIVER_LICENSE`/`VEHICLE_ID` a un CF.
- [ ] Se il PoC resta candidato, concordare budget RAM e protocollo aggiuntivo di durata/concorrenza, con RSS, cgroup anon/file, picchi e heap V8 su deployment rappresentativo. Le serie precedenti non dimostrano stabilità indefinita.
- [ ] Solo dopo review dei risultati e autorizzazione esplicita, decidere se estendere il PoC o proporre l'integrazione; non integrare automaticamente.
- **Status:** pending (gate aperto; nessuna integrazione autorizzata)

### Phase 9: Indagine sulle latenze Horizon, senza modifiche al codice applicativo
- [x] Profilati tokenizer/guard, inferenza, postprocessing e recognizer CF sul corpus sintetico: la chiamata al modello domina il percorso misurato; il CF non spiega la latenza. Distinguere un campo da una richiesta bulk con 11 campi inferiti in serie.
- [x] Variato solo `session_options.intraOpNumThreads` in un detector scratch montato read-only nell'immagine q8 invariata, con quota 2 CPU/4 GiB; tre run locali per default e 2 thread, due coppie HTTP in ordine invertito. Verificati gli stessi verdetti/categorie/versione policy sulle 78 probe del corpus e 0 errori HTTP, inclusi i burst. L'uguaglianza delle uscite osservate non dimostra equivalenza su altri input né parità dei punteggi.
- [x] Provato batching esplorativo su 11 testi identici e 11 variati: migliora solo i primi nei campioni misurati; non modificare il percorso bulk sulla sola base del microbenchmark. Documentati dispersione fra run, limite degli 8 campioni burst (p95 = massimo), possibili falsi positivi/negativi e necessità di benchmark su hardware rappresentativo prima di qualunque scelta produttiva.
- **Status:** complete (indagine; 2 thread e batching non implementati nel PoC)

### Phase 10: Condivisione Infra/Business, motivazione API e navigazione test
- [x] README principale: motivazione del presidio, percorsi di valutazione per i due team, scelta HTTP come frontiera comparativa e trade-off in-process, sicurezza e limiti dei risultati.
- [x] Test di confronto spostati in `comparison/tests/`, import corretti e guida ai cinque file; `comparison/corpus.json` e `comparison/run.mjs` restano visibili come dataset e runner distinti.
- [x] Comandi e link aggiornati in `comparison/README.md` e `poc-horizon/README.md`; prerequisito prefetch Docker esplicito e descrizione swap corretta.
- [x] Verifica: 17 test confronto, 16 Horizon, 18 spaCy; runner Docker 39/39 per motore e 0 errori tecnici; link relativi e assenza di input sintetici nel report verificati.
- [x] Review avversariale del diff: corretta la cronologia della memoria dopo CF, esplicitato Node.js ≥22 e incluso l'intero set di file nell'indice Git, con import spostati e README dei test.
- [x] Ripetuto il runner Docker con quota di 2 CPU per container dopo riavvio del daemon; verificati 39/39 campioni e 0 errori per motore, numeri del README aggiornati dal nuovo report locale.
- [x] Prima review indipendente: tre rilievi medi corretti; seconda review: due rilievi medi su protezione del report generato e copia untracked, corretti con comandi a permessi riservati e regola locale `.git/info/exclude`. Terza review indipendente: PASS, nessun blocker/high/medium.
- [x] Review dell'utente sulla preview locale del README e autorizzazione esplicita a pubblicare l'intero set documentale direttamente su `main`, senza PR.
- **Status:** complete (documentazione, test spostati e confronto; nessuna integrazione autorizzata)

## Finding funzionale storico (prima della regex CF) e interpretazione
- Durante una prova dell'utente con nome e identificativo fiscale **[REDACTED]**, il servizio ha rifiutato con `PERSON` e `DRIVER_LICENSE`, benché l'utente abbia confermato di non aver inserito dati di patente. La categoria `DRIVER_LICENSE` è errata rispetto al contenuto dichiarato; **non** è evidenza di una patente. Il rifiuto può essere coerente con la policy conservativa, ma non rende corretta la motivazione.
- Diagnosi distinta con soli dati sintetici già disponibili: codice fiscale isolato → `VEHICLE_ID`; insieme a nome → `DRIVER_LICENSE`, `PERSON`; con prefisso esplicito «codice fiscale» → `DRIVER_LICENSE`, `NATIONAL_ID`. Prima del recognizer il PoC non rilevava affidabilmente `IT_FISCAL_CODE`; oggi la regex riconosce i casi plausibili del corpus, mentre le etichette native errate possono ancora coesistere. Senza span nella risposta HTTP non si può attribuire con certezza una singola etichetta alla sottostringa che l'ha prodotta.
- Horizon non è un sostituto drop-in di Presidio/spaCy: le etichette native e le soglie non coincidono. Il benchmark sintetico iniziale mostra 2 TP/0 FN Horizon nelle categorie comuni attese e una categoria attesa non supportata; spaCy 3 TP/2 FP nel set di 8 categorie. Sono numeri descrittivi di un corpus minuscolo, non una classifica di qualità.

## Decisioni e sicurezza
- Il motivo del PoC alternativo era verificare se una pipeline ONNX/JavaScript senza spaCy potesse cambiare il comportamento di crescita memoria osservato, non cercare un modello più piccolo. La memoria assoluta misurata di Horizon è maggiore; nessuna conclusione sulla crescita a tempo indefinito.
- Nessun dato personale reale nei test ripetibili, nei log, nei corpus o nelle note; il rilievo dell'utente è riportato senza valori identificativi. **Non inviare dati personali reali né esporre la porta pubblicamente.** Per le prove, **usa soltanto dati sintetici.** Il servizio locale è privo di autenticazione e deve restare su `127.0.0.1`.
- Fail-closed per errori tecnici, coda piena e input fuori budget; nessuna cache di testi o verdetti. Non restituire né registrare testo, span, offset o score nel contratto pubblico. La restrizione storica sui commit non è più vigente: l'utente ha autorizzato i commit locali del PoC e ora la pubblicazione su un branch dedicato; nessuna integrazione autorizzata.

## Errors Encountered (storico)
| Errore | Esito |
|---|---|
| Init PWF prima della creazione della directory | Creata `.hermes/plans/poc-horizon-comparison/`; note in `.hermes/notes/`. |
| Docker Desktop non raggiungibile in un tentativo preliminare | Tentativo non classificato come OOM; serie definitive rieseguite. |
| Input sperimentali oltre 512 token | Generatore corretto; massimo verificato 481 token nei testi lunghi definitivi. |
| `rtk uv` in background non disponibile | Test Python rilanciati in foreground, 18 passati. |
| Docker Desktop non raggiungibile durante la prima ricostruzione post-fix | Riavviato; daemon verificato e immagine ricostruita; smoke e contratto container ripetuti. |
