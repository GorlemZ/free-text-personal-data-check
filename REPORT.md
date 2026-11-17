# Valutazione del servizio di controllo dei dati personali

Aggiornamento: 17 novembre 2026. Risultati funzionali correnti: golden `category-detection-1`, 142 casi e 426 osservazioni complete nel [bundle v3](tests/evaluation/results/category-detection-v3-2026-11-17/results.json).

## Sintesi

Il repository confronta tre implementazioni dello stesso servizio HTTP:

- **Horizon**, basato su un modello ONNX q8 eseguito in Node.js e regole per le categorie non coperte dal modello;
- **Rizzo**, basato su un modello ONNX fp32 eseguito in Node.js e regole integrative;
- **Presidio**, usato come termine di confronto e basato sulla libreria Python con modello italiano.

I tre motori ricevono gli stessi campi, applicano la stessa policy sulle categorie consentite e restituiscono lo stesso formato di risposta per le richieste valide. Il contratto documenta differenze di parsing sugli input malformati, in particolare UTF-8 non valido e chiavi JSON duplicate. Nel confronto funzionale sul golden `category-detection-1`, Horizon ha ottenuto l'accuratezza più alta sul verdetto business: **95,07%**, contro **92,25%** di Rizzo e **80,28%** di Presidio.

La parte prestazionale è ancora preliminare. Gli screening A, B e C misurano configurazioni diverse con carichi closed-loop brevi. Non sostituiscono le curve open-loop, i cold start ripetuti e i run prolungati necessari per stimare la capacità produttiva.

## Flusso del servizio

Una richiesta contiene fino a 10 campi e fino a 50 parole per campo. Ogni campo dichiara le categorie consentite. Il servizio:

1. valida richiesta, identificativi dei campi e categorie;
2. esegue la detection sul testo;
3. confronta le categorie rilevate con quelle consentite per il campo;
4. restituisce `accepted` se non trova categorie vietate, altrimenti `rejected` con le sole coppie `fieldId`/categoria.

Il contratto comprende nove categorie: persona, email, telefono, codice fiscale, partita IVA, IBAN, carta di pagamento, carta d'identità italiana e patente italiana. La risposta non include testo estratto, span, score o dettagli del modello. Errori di input e indisponibilità tecnica restano separati dal verdetto di business.

Rizzo e Horizon eseguono l'intera detection nel processo Node.js e non contengono Python nelle immagini. I due servizi condividono il package HTTP, il parser JSON con limite di 1 MiB, la validazione Zod e una coda FIFO bounded. Presidio mantiene il proprio runtime Python ed è sottoposto allo stesso contratto esterno.

## Metodo della valutazione funzionale

Il golden `category-detection-1` contiene 142 casi autonomi nella forma `{id, text, expected}`. Provenance, policy annotate, span, offset, note di review e configurazioni di limite/memoria sono esclusi dal corpus.

Per ogni caso il runner invia una sola richiesta HTTP a Rizzo, Horizon e Presidio con `allowedCategories: []`. Il confronto misura:

1. verdetto business `accepted`/`rejected` restituito via HTTP;
2. uguaglianza del body completo `{verdict, findings}`;
3. presenza di ciascuna delle nove categorie.

Il bundle contiene **426 osservazioni complete su 426 previste**, senza errori tecnici o contrattuali. Il runner non esegue retry. La migrazione non modifica codice, configurazioni o test propri dei servizi. Errori HTTP, trasporto o schema interrompono la raccolta e non vengono conteggiati come errori di classificazione.

Il golden contiene 99 casi da rifiutare e 43 da accettare. Il campione è di sviluppo e non è held-out; le percentuali descrivono questo corpus e non dimostrano generalizzazione.

## Correttezza del verdetto e del body

Positivo significa "rifiuto atteso". Un falso negativo è un testo accettato per errore; un falso positivo è un testo rifiutato per errore.

| Motore | TP | FP | FN | TN | Accuratezza | Body esatti |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Horizon | 98 | 6 | 1 | 37 | **95,07%** | **122/142** |
| Rizzo | 97 | 9 | 2 | 34 | **92,25%** | **113/142** |
| Presidio | 79 | 8 | 20 | 35 | **80,28%** | **101/142** |

Horizon accetta per errore 1 caso sui 99 da rifiutare; Rizzo 2 e Presidio 20. Sui 43 casi da accettare, Horizon ne rifiuta 6, Rizzo 9 e Presidio 8. Il body esatto è un criterio più forte del verdetto: richiede le categorie corrette e nessun finding aggiuntivo.

## Detection per categoria

La sensibilità misura quanti positivi attesi vengono trovati. La precisione misura quante segnalazioni appartengono alla categoria attesa. L'unità è la presenza della categoria nel testo, non il numero di entità o lo span.

| Categoria | Positivi | Rizzo sens. | Rizzo prec. | Horizon sens. | Horizon prec. | Presidio sens. | Presidio prec. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Persona | 61 | 96,72% | 100% | 96,72% | 100% | 77,05% | 79,66% |
| Email | 22 | 100% | 100% | 100% | 95,65% | 100% | 100% |
| Telefono | 16 | 75% | 75% | 100% | 76,19% | 81,25% | 86,67% |
| Codice fiscale | 14 | 100% | 82,35% | 100% | 100% | 100% | 100% |
| Partita IVA | 6 | 83,33% | 55,56% | 100% | 85,71% | 50% | 75% |
| IBAN | 8 | 100% | 33,33% | 100% | 88,89% | 62,50% | 100% |
| Carta di credito | 14 | 100% | 77,78% | 100% | 63,64% | 64,29% | 100% |
| Carta d'identità italiana | 4 | 75% | 100% | 75% | 100% | 100% | 100% |
| Patente italiana | 5 | 80% | 100% | 80% | 100% | 60% | 100% |

I risultati evidenziano compromessi diversi. Horizon trova tutti i positivi per telefono, partita IVA, IBAN e carta di credito, con falsi positivi soprattutto su telefono e carte. Rizzo trova tutti gli IBAN ma aggiunge 16 falsi positivi nella categoria. Presidio mantiene precisione piena su diverse categorie strutturate, con minore sensibilità su persona, partita IVA, IBAN, carte e patente.

Il corpus conserva positivi, negativi, near-miss, checksum errati riconoscibili, overlap e formati insoliti. Non misura policy con allowlist non vuote, error handling, limiti, memoria o prestazioni. Un esito `accepted` resta euristico e non prova l'assenza di dati personali.

## Configurazioni tecniche valutate

Gli screening usano una replica limitata a 2 CPU e `4_000_000_000` byte di RAM. La quota CPU limita il tempo disponibile e non equivale al pinning di due core fisici.

| Configurazione | Motore | Struttura | Risultato breve | Memoria osservata |
| --- | --- | --- | --- | ---: |
| Candidate A | Horizon | 1 processo, ORT 2/1, 1 richiesta attiva | 8,65 req/s; p90 267,3 ms | 2.304.770.048 B post-load |
| Candidate A | Rizzo | 1 processo, ORT 2/1, 1 richiesta attiva | 6,84 req/s; p90 313,2 ms | 2.307.670.016 B post-load |
| Candidate B | Horizon | 1 processo, ORT 1/1, 2 richieste attive | 5,12 req/s; p90 752,6 ms | 2.363.596.800 B, massimo campione |
| Candidate B | Rizzo | 1 processo, ORT 1/1, 2 richieste attive | 5,02 req/s; p90 789,7 ms | 2.962.227.200 B, massimo campione |
| Candidate C | Horizon | 2 processi, ORT 1/1 per processo | 6,78 req/s; p90 469,6 ms | 3.993.735.168 B al cold load |
| Candidate C | Rizzo | 2 processi, ORT 1/1 per processo | caricamento non completato | OOM del cgroup |

Candidate A è lo screening seriale con il miglior throughput osservato per entrambi i motori. Candidate B supera il target p90 di 500 ms. Candidate C raggiunge quel target per Horizon nel singolo run, ma durante il cold start rimane a circa 6,3 MB dal limite; Rizzo non riesce a caricare due modelli nel cap.

I carichi non sono omogenei: Candidate A usa un client seriale, mentre B e C usano due client closed-loop. Le differenze di throughput e latenza sono diagnostiche. Non costituiscono una graduatoria di capacità sostenibile.

## Coda, concorrenza e comportamento in errore

La configurazione attuale ammette due richieste attive e quattro pending per processo, con attesa massima di 500 ms. La coda è FIFO e bounded. Una richiesta in eccesso o scaduta riceve `503 detector_unavailable`; il servizio rimuove dalla coda il lavoro scaduto e non avvia la relativa inferenza.

Il gate di Candidate B ha confrontato 40 risposte concorrenti con quattro baseline seriali per ciascun motore. Tutte le risposte sono rimaste equivalenti e una richiesta valida ha conservato il proprio risultato mentre una richiesta parallela falliva per overflow del budget token.

Il timeout di coda resta best-effort quando l'event loop Node è occupato da inferenza CPU-bound. Manca inoltre la cancellazione dell'inferenza già avviata e la rimozione immediata dei pending quando il client si disconnette.

## Confini di sicurezza e privacy

I PoC non implementano autenticazione o autorizzazione. Devono restare su loopback o dietro una rete protetta e un controllo di accesso esplicito. Le `allowedCategories` devono provenire da una configurazione fidata: accettare dal chiamante categorie arbitrarie può indebolire la policy.

Il campo `fieldId` deve essere un identificativo tecnico e non deve contenere dati personali. Log, metriche e tracing devono escludere i testi analizzati e i dettagli che potrebbero ricostruirli. Un verdetto `accepted` significa soltanto che il motore non ha rilevato categorie vietate nel campione ricevuto; non prova che il testo sia privo di dati personali.

## Evidenze e riproducibilità

La raccolta usa i tre endpoint containerizzati già disponibili, senza modifiche né esecuzione delle suite locali dei servizi. Le prove della suite golden sono passate. Il bundle contiene 426/426 osservazioni e il renderer offline riproduce byte per byte le sei esportazioni.

Il bundle pubblicato esclude testi, provenance, span, score, note libere e body di errore. Il test del bundle riconta osservazioni e matrici, verifica gli invarianti per motore/categoria e impedisce la pubblicazione di testi del golden.

Artefatti principali:

- [metodo e comandi](tests/evaluation/README.md);
- [report funzionale completo](tests/evaluation/results/category-detection-v3-2026-11-17/report.md);
- [risultati machine-readable](tests/evaluation/results/category-detection-v3-2026-11-17/results.json);
- [Candidate A](tests/resources/results/phase-a-candidate-a-2026-11-16/report.md), [Candidate B](tests/resources/results/phase-b-candidate-b-2026-11-16/report.md) e [Candidate C](tests/resources/results/phase-c-candidate-c-2026-11-16/report.md).

## Attività ancora necessarie

La valutazione funzionale a tre motori è completa sul golden `category-detection-1`. La caratterizzazione produttiva richiede ancora:

- curve open-loop omogenee al 50%, 75%, 100%, 125%, 150% e 200% della capacità stimata;
- run prolungati e cold start ripetuti;
- serie temporali di memoria, profondità della coda, CPU throttling ed event-loop lag;
- prove di recovery dopo burst, timeout, crash e OOM;
- una scelta verificata del routing quando una replica usa più processi.

Finché queste misure non saranno disponibili, i dati A/B/C restano screening tecnici e non una dichiarazione di capacità produttiva.