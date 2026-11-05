# Progress — PoC Horizon/spaCy

## Sessione 2026-11-04
- Phase 1 complete: verificati checkout remoto/locale, sorgenti Python, metadata Horizon, versione pacchetto JS.
- Phase 2 complete: due review rapide indipendenti; aggiunti smoke reale prima del servizio, manifest e boot offline, contratto e label map, budget token, metriche anon/file-cache e criterio bounded.
- Phase 3 complete: software storico spostato senza modifiche in `poc-spacy/`; Node PoC con modello ONNX q8 locale in `poc-horizon/`; smoke reale host (EMAIL e coda rilevate, >512 token respinti), test unitari 7/7, benchmark sintetico eseguito. Docker immagini costruite e smoke offline riuscito; ottimizzato Dockerfile eliminando `chown` che duplicava ~1,17 GB di layer. Suite wire condivisa 6 casi su entrambe le immagini: PASS.
- Phase 4 in progress: primo probe esplorativo con bassa diversità lessicale (spaCy 2×1000, memoria quasi piatta ma input poco innovativi); generatore aggiornato per inserire 16/32/40 token artificiali **nuovi per richiesta**. Primo tentativo Horizon in parallelo a build/spaCy/smoke interrotto dal daemon Docker Desktop scomparso: non è un OOM attribuibile al container. Un successivo run Horizon 1×1000 ha avuto 30 risposte tecniche perché 30 input lunghi erano >512 token (verificato contando i token localmente); i 503 non vanno interpretati come guasto della cache. Ridotte le pseudo-parole lunghe a 40 e verificato con il tokenizer che il massimo per le 232 richieste lunghe è 481 token. Secondo run errato interrotto volontariamente e container residuo rimosso. Le serie definitive su immagine ricostruita con limite 4 GiB sono in corso senza prove pesanti parallele.
- Phase 5 in progress: review avversariale rapida post-implementazione ha individuato 3 problemi; corretto decoding UTF-8 con TextDecoder fatal e test, reso esplicito il conteggio sulle categorie condivise nel benchmark, aggiunto runner wire reale per le due immagini; il probe ora ispeziona il container in caso di interruzione prima del cleanup per riferire OOM/exit quando il daemon è disponibile.
- Errore: PWF init prima della creazione della directory ha dato FileNotFoundError; corretto usando `cwd` dopo `mkdir -p`.
- Errore: una chiamata `execute_code` per calcolare hash dei tre piccoli file modello è stata bloccata senza consenso: non ritentata. Manifest usa SHA256 pubblicati dal Hub per i due file LFS grandi e revision+size per gli altri.
- Errore: `rtk uv run` avviato in background ha fallito lo spawn; rilanciato in foreground: 18 test Python passati, Ruff check/format passati.

## Verifiche
| Verifica | Risultato |
|---|---|
| `git ls-remote origin refs/heads/main` | SHA locale/remoto coincidenti |
| Hub API file e label | modello ONNX quantizzato presente; labels verificate |
| Test Python | 18 passed; Ruff check e format OK |
| Test Node | 7 passed; smoke reale e smoke offline OK |
| Contratto HTTP comune | 6 check su entrambe le immagini: PASS |
| Benchmark sintetico | 10 esempi per implementazione; Horizon categorie comuni 2 TP/0 FN, 1 categoria attesa non supportata; spaCy 3 TP/2 FP nel set a 8 categorie |
| Docker | immagini costruite; dimensioni e prove sotto |

## Probe memoria finale — 4 GiB, swap disabilitato, 1 processo/container

Ogni serie: container nuovo, warmup 20 richieste, poi 1.000 input sintetici diversi (256 brevi, 512 medi, 232 lunghi), 16/32/40 pseudo-parole inedite per richiesta; 4 client nell'ultimo 10%, inferenza Horizon seriale. Sono misure **campionate**, non massimi assoluti. `memory.peak` non disponibile. `anon` e `file` dal cgroup distinguono in parte heap/arena da page cache; la heap V8 non è misurata separatamente. Il criterio permissivo `indicativePlateau` è `true` nelle 4 serie, ma può nascondere deriva lenta.

| Motore | Serie | RSS MiB 0 / 250 / 500 / 750 / 1000 | `memory.current` MiB 0 / 250 / 500 / 750 / 1000 | Errori/OOM | p50/p95 HTTP ms |
|---|---:|---|---|---|---|
| Horizon | 1 | 1340,4 / 1601,1 / 1532,8 / 1532,1 / 1556,7 | 1281,5 / 1543,1 / 1471,6 / 1471,1 / 1496,0 | 0/false | 467,7 / 2301,6 |
| Horizon | 2 | 1357,6 / 1602,5 / 1533,6 / 1533,1 / 1556,9 | 1298,3 / 1543,8 / 1472,0 / 1471,4 / 1495,8 | 0/false | 435,3 / 2698,5 |
| spaCy | 1 | 177,5 / 178,3 / 180,6 / 182,4 / 184,9 | 146,5 / 147,0 / 149,4 / 151,2 / 153,9 | 0/false | 12,3 / 68,7 |
| spaCy | 2 | 177,5 / 178,3 / 180,6 / 182,4 / 185,0 | 146,3 / 146,8 / 149,2 / 151,0 / 153,6 | 0/false | 12,0 / 71,3 |

Horizon mostra una salita iniziale fino a 250 e poi un livello comparabile nelle due serie: fra 500 e 1000 RSS +23,9/+23,3 MiB (~1,5%), coerente con il passaggio a testi lunghi a 768; sulla fascia di lunghezza media 500→750 è quasi piatto. spaCy mostra aumento RSS monotono: +4,3/+4,4 MiB fra 500 e 1000, nonostante un valore assoluto molto minore. Questi dati **non provano** limite superiore della cache Horizon né crescita illimitata spaCy: durata e forme di input sono limitate. Il `file` campionato nelle serie definitive è ~0–0,2 MiB; in uno smoke preliminare Horizon la page cache era ~728,5 MiB, quindi `memory.current` è sensibile allo stato dell'host. Limite 4 GiB scelto per il PoC; non è una raccomandazione di sizing.

Dimensione immagine Docker: Horizon 1.582.037.336 byte (~1508,7 MiB), spaCy 847.664.619 byte (~808,4 MiB). La dimensione immagine NON è il consumo RAM.

### Limitazioni e anomalie
- Primo tentativo parallelo: Docker Desktop ha perso il daemon; impossibile attribuire un OOM al container, stato non verificabile al momento del guasto.
- Run Horizon precedente con 48 pseudo-parole lunghe: 30 richieste superavano 512 token e ricevevano 503; misurato con tokenizer (max 553). Ridotti a 40, max misurato 481 token, tutte le 2×1000 richieste definitive hanno risposto 200.
- Il generatore definitivo emette pseudo-parole sintetiche; non rappresenta distribuzione reale. Le 4 richieste in burst non dimostrano analisi concorrente: Horizon serializza, spaCy esegue detect sincrono nell'endpoint async.
- `memory.peak` assente; il valore massimo di RSS nei checkpoint non è un picco assoluto. La prova non dimostra sicurezza a 256 MiB o idoneità produttiva.

## Sessione 2026-11-04 — test manuale e arresto

- Avviato `poc-horizon/src/server.mjs` in locale, bound a `127.0.0.1:8000`; readiness `200`, test sintetici neutro/email con esiti attesi. Nessuna modifica al codice applicativo.
- L'utente ha segnalato un rifiuto con categoria `DRIVER_LICENSE` su input reale nome + identificativo fiscale **[REDACTED]**, senza dati di patente. Classificazione errata della categoria; non confondere il rifiuto dell'input con precisione della motivazione. Nessun valore reale copiato nei file o reinviato al servizio durante la diagnosi.
- Diagnosi con soli dati sintetici già nel corpus: codice fiscale isolato → `VEHICLE_ID`; insieme a nome → `DRIVER_LICENSE`, `PERSON`; con indicazione esplicita di codice fiscale → `DRIVER_LICENSE`, `NATIONAL_ID`. Rilievo e gate prima dell'integrazione in `findings.md`; non implementata alcuna correzione del modello/policy in questa sessione.
- **Su richiesta dell'utente, fermato il processo del server** (sessione `proc_4709ebfe3ba1`); controllo successivo: nessun listener TCP su `127.0.0.1:8000` e richiesta readiness non raggiungibile (`SERVER_STOPPED`).

## Sessione 2026-11-04 — recognizer sintattico CF
- Piano Phase 6 riveduto da un subagent indipendente: un high (regola di forma imprecisa) e un medium (prova HTTP incompleta), entrambi incorporati prima del codice.
- Tracer TDD: richiesta HTTP CF sintetico ha fallito con `findings: []`, poi è passata con regex e fusione nel servizio; versione `poc2` e benchmark CF hanno anch'essi avuto RED atteso e GREEN verificato.
- `npm test`: 16/16; smoke reale host e container `--network none`: CF rilevato da `/v1/analyze`, input >512 token respinto 503; `npm run bench`: 10 esempi, `IT_FISCAL_CODE` 1 TP/0 FN, 0 errori tecnici, senza implicazioni di generalizzabilità.
- Docker Horizon ricostruito (immagine `sha256:94efae272d376f1c621cf18654e239634bb761055d1c66898d9d796ee7004303`); verifica manifest in build riuscita; runner contratto HTTP sui due container: 6/6 check per immagine passati. Memoria non ri-misurata.
- `node --check` sui moduli/smoke toccati e `git diff --check` riusciti. Review indipendente del codice ancora pendente; nessun commit/push.
- Review indipendente del codice: un rilievo medium sul confine Unicode (segni combinanti non esclusi). Aggiunto test RED su segno combinante adiacente, corretta regex con `\p{M}`, rieseguiti 16 test Node, smoke reale host e benchmark: tutti passati.
- Prima ricostruzione Docker post-fix bloccata dal daemon non raggiungibile; riavviato Docker Desktop e verificata la disponibilità del daemon. Nuova immagine `sha256:d3ad44a7009cbc35392302191bb2b4b19c3e31d912b90553c568ae4685112246`; contratto 6/6 su entrambe le immagini e smoke offline nel container riusciti. Nessun test memoria ripetuto.
- Seconda review indipendente del diff CF: PASS, nessun blocker/high/medium residuo. Phase 6 completata localmente, Phase 7 resta aperta per il confronto funzionale futuro e l'eventuale decisione d'integrazione; nessun commit o push.

## Sessione 2026-11-04 — confronto condiviso
- `origin/main` ha incorporato il PoC base con merge `bf5c0d9`; main locale portato allo stesso commit preservando le modifiche CF, senza checkout di una tree diversa.
- Review avversariale del piano Phase 7: 3 high e 3 medium (matrice categorie, ground truth/denominatori, risposte fail-closed, saturazione, latenza/bulk, scope commit). Contratti e test definiti nel piano prima dell'implementazione.
- CF Phase 6 già revisionato: su main `npm test` 16/16 e smoke modello reale passati; commit locale diretto `8c6542e feat(horizon): detect plausible Italian fiscal codes`, 11 file esplicitamente staged. Nessun push; piano/notes ancora modificati ma non inclusi nel commit CF.
- Phase 7: TDD su metriche e contratto; suite 10/10 test passati. Corpus di 39 testi sintetici con copertura positivo/negativo per ciascuna delle 18 categorie, più neutro e due allowlist. Due probe HTTP separano detection dalla policy. Test handler: errore nel secondo campo, label ignota, quattro slot occupati e quinto 503, senza timer euristico.
- Baseline dopo modifiche: Horizon 16/16 + smoke reale; spaCy pytest 18/18 + Ruff; Docker build Horizon nuova `sha256:b67e249e691d5f3d2f667cdd3032f91d3e2205a289ab5a1c7e9a9f8bfb4b333d`, contratto HTTP 6/6 per entrambe le immagini. Runner reale 39/39 campioni per motore e 0 errori tecnici; dettagli e limitazioni in `comparison/README.md` e report aggregato in `.hermes/notes/poc-horizon-comparison-report.json` (nessun testo/spans/score).
- Review avversariale finale del diff Phase 7 avviata; non creare ancora il secondo commit finché eventuali rilievi non siano corretti. Nessun push.
- Prima review diff Phase 7: CHANGES REQUESTED, un high (cleanup Docker poteva fallire senza fermare il run) e due medium (finding riferito a un fieldId diverso e test 17 campi non isolava il count limit). Aggiunti test RED per contratto/metrica e cleanup; corretta la lifecycle per tracciare il nome prima del run, verificare via `docker ps -a` la rimozione e fallire quando non verificabile; binding tra finding e campo richiesto, esclusione di categoria allowlisted nella risposta policy. Il test 17 campi è etichettato come invalidità combinata, non prova indipendente del max 16.
- Dopo il fix: suite confronto 14/14, runner reale 39/39 per motore, 0 errori tecnici, nessun container `poc-comparison` residuo; report/README/notes aggiornati con le nuove latencies. Seconda review indipendente necessaria prima della Phase 7 completa/commit.
- Seconda review diff: precedenti tre rilievi chiusi, un medium nuovo: risposta HTTP ricevuta con content-type errato/JSON malformato veniva assorbita come `status:0` e poteva lasciare la suite verde. Test RED e implementazione `comparison/http-client.mjs`: risposta non conforme -> `INVALID_RESPONSE` hard fail, timeout/trasporto -> technical error separato; errori senza body nei log. Suite confronto 17/17, terza review finale da svolgere. Nessun commit Phase 7 o push.
- Terza review diff: CHANGES REQUESTED, un medium residuo: `comparison/http-client.mjs` accetta `application/json-invalid` perché usa `startsWith('application/json')`. Reviewer ha riprodotto 200 accettato con media type non valido. Limite di tre iterazioni raggiunto: Phase 7 non chiusa, nessun commit Phase 7; chiedere all'utente come procedere prima di una quarta review. I gate precedenti non provano la validità esatta del media type.
- Decisione esplicita dell'utente: correggere e committare **senza** quarta review. Test RED sul media type `application/json-invalid`, correzione tramite parsing fino a `;` e confronto esatto con `application/json` (case-insensitive); test per charset valido. Suite confronto 17/17 e runner reale 39/39 campioni per motore, 0 errori tecnici, nessun container residuo; report/README/notes latenza aggiornati. Il fix finale resta **non revisionato indipendentemente**; nessun push.

## Sessione 2026-11-04 — ripetizione test dopo CF, prima richiesta esclusa
- Ricostruite immagini locali da `main` (`99e74cf` confronto, `8c6542e` CF), senza push e senza nuove modifiche applicative. Test comparativi 17/17, Horizon 16/16 + smoke, spaCy 18/18 + Ruff e contratto HTTP per entrambe le immagini: exit 0. Runner reale: 39/39 campioni completati per motore, 0 errori; CF Horizon 2/2 rilevati, spaCy 0/2. Il report del run è in scratch `comparison-retest.json`; il report versionato preesistente non è stato sovrascritto.
- La prima analisi dopo readiness è separata e non entra in warm/corpus. Warm p50/p95 ms spaCy 6,67/6,94, Horizon 75,10/90,47; corpus 78 richieste spaCy 6,07/8,40, Horizon 91,04/190,42; bulk 11 campi spaCy 26,89, Horizon 497,37. Verdetti 39 campioni invariati: spaCy TP/FP/FN/TN 16/10/2/11; Horizon 16/11/2/10.
- Due serie **nuove dopo CF** da 1.000 richieste per motore con 20 warmup: 0 errori e 0 OOM. RSS PID 1 massima campionata spaCy 184,9/184,9 MiB; Horizon 1.598,4/1.602,8 MiB. Il benchmark memoria include il warmup nel proprio p50/p95: tali percentili non vengono usati per affermare l'esclusione della prima richiesta. Review indipendente read-only ha verificato la separazione cold/warm/corpus e segnalato questa limitazione.
- Errori operativi: un `npm test` invocato dalla radice anziché da `poc-horizon/` ha restituito exit 254; rilanciato dalla directory corretta e passato. Un primo run memoria Horizon in foreground è scaduto al timeout del tool senza completare la prima serie, lasciando un container temporaneo: rimosso per nome, run completo 2×1.000 ripetuto in background con exit 0; cleanup Docker successivamente verificato.

## Sessione 2026-11-04 — diagnosi prestazionale Horizon, solo scratch
- Profilato l'attuale q8 sul corpus di 39 campioni sintetici: mediana modello 72,2 ms, guard tokenizer 0,32 ms, recognizer+categoria 0,01 ms. Testata `session_options.intraOpNumThreads: 2` con file detector scratch montato read-only; tre run diretti p50 default 78,45/76,20/75,19 ms contro 30,50/30,66/30,97 ms con 2 thread. Categorie finali e CF sul corpus coincidono; nessuna modifica a `poc-horizon/src/detector.mjs`.
- Due coppie HTTP controbilanciate: baseline→tuned e tuned→baseline, ciascuna con 78 probe del corpus, una bulk 11 campi e 8 burst; 0 errori HTTP, prima richiesta separata, stessi digest di verdetti/categorie/versione policy entro ciascuna coppia. Corpus p50/p95 baseline 108,06/291,98 e 79,72/181,10 ms, tuned 39,44/95,90 e 35,58/92,50 ms; bulk baseline 815,37/297,99 ms, tuned 165,93/241,52 ms. Alta variabilità: non trattare bulk singolo o burst N=8 come SLA. Review avversariale ha evidenziato che il digest non confronta score o casi vicini alla soglia; dopo review lo script scratch HTTP richiede anche `200` e versione policy nel burst.
- Batching diretto N=11 con 2 thread: identici p50 seriale/batch 168,64/95,48 ms, variati 283,77/328,58 ms; nessun cambio alla API. Candidate model `pii-redactor-small` solo individuato, non scaricato né valutato. File di prova esclusivamente in scratch; nessun container di prova residuo, worktree prima di questa annotazione pulito, nessun push.
- Questa annotazione aggiorna solo il piano PWF e i due file di note in `.hermes/`; nessuna implementazione della configurazione ONNX a 2 thread è stata autorizzata o applicata. La Phase 8 rimane pending.
