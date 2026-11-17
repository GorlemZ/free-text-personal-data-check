# Valutazione del servizio di controllo dei dati personali

Aggiornamento: 17 novembre 2026.

## Sintesi

Il repository confronta tre implementazioni dello stesso servizio HTTP:

- **Horizon**, basato su un modello ONNX q8 eseguito in Node.js e regole per le categorie non coperte dal modello;
- **Rizzo**, basato su un modello ONNX fp32 eseguito in Node.js e regole integrative;
- **Presidio**, usato come termine di confronto e basato sulla libreria Python con modello italiano.

I tre motori ricevono gli stessi campi, applicano la stessa policy sulle categorie consentite e restituiscono lo stesso formato di risposta per le richieste valide. Il contratto documenta differenze di parsing sugli input malformati, in particolare UTF-8 non valido e chiavi JSON duplicate. Nel confronto funzionale sul golden esteso, Horizon ha ottenuto l'accuratezza più alta sul verdetto HTTP: **94,70%**, contro **89,40%** di Rizzo e **78,81%** di Presidio.

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

Il golden `uniform-pilot-3` contiene:

| Voce | Totale |
| --- | ---: |
| Scenari | 151 |
| Campi | 152 |
| Testi distinti | 142 |
| Famiglie dichiarate | 85 |
| Coppie categoria ambigue | 13 |
| Rifiuti attesi | 98 |
| Accettazioni attese | 53 |

Per ogni scenario e motore il runner invia due richieste HTTP:

- una richiesta di **detection**, con tutte le categorie vietate, per misurare la presenza delle categorie per campo;
- una richiesta di **policy**, con le allowlist annotate, per osservare il verdetto HTTP effettivo.

Il run del 17 novembre ha completato **906 richieste su 906**, senza errori tecnici o contrattuali e senza retry selettivi. Le matrici usano soltanto richieste riuscite su tutti e tre i motori. Le 13 coppie ambigue sono escluse dalla detection e non vengono trasformate in veri negativi.

Il campione è di sviluppo e non è held-out. Contiene testi e scenari correlati; le percentuali descrivono il corpus valutato e non dimostrano generalizzazione su traffico produttivo.

## Correttezza del verdetto

Positivo significa "rifiuto atteso". Un falso negativo è quindi uno scenario accettato per errore; un falso positivo è uno scenario rifiutato per errore.

| Motore | TP | FP | FN | TN | Accuratezza | Sensibilità | Precisione |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Horizon | 97 | 7 | 1 | 46 | **94,70%** | 98,98% | 93,27% |
| Rizzo | 94 | 12 | 4 | 41 | **89,40%** | 95,92% | 88,68% |
| Presidio | 78 | 12 | 20 | 41 | **78,81%** | 79,59% | 86,67% |

Horizon accetta per errore 1 scenario su 98 da rifiutare. Rizzo ne accetta 4 e Presidio 20. Sui 53 scenari da accettare, Horizon ne rifiuta 7; Rizzo e Presidio 12.

La correttezza del solo verdetto non basta a valutare la detection: una richiesta può essere rifiutata per una categoria diversa da quella annotata. Per questo il benchmark misura anche le categorie rilevate campo per campo.

## Detection per categoria

La sensibilità misura quanti positivi attesi vengono trovati. La precisione misura quante segnalazioni appartengono alla categoria attesa.

| Categoria | Positivi | Rizzo sens. | Rizzo prec. | Horizon sens. | Horizon prec. | Presidio sens. | Presidio prec. |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Persona | 63 | 96,83% | 96,83% | 96,83% | 98,39% | 76,19% | 72,73% |
| Email | 24 | 100% | 96% | 100% | 96% | 100% | 100% |
| Telefono | 20 | 80% | 80% | 100% | 80% | 85% | 85% |
| Codice fiscale | 17 | 100% | 85% | 100% | 100% | 100% | 100% |
| Partita IVA | 10 | 40% | 44,44% | 100% | 90,91% | 70% | 87,5% |
| IBAN | 9 | 100% | 31,03% | 100% | 90% | 66,67% | 100% |
| Carta di credito | 14 | 100% | 73,68% | 100% | 63,64% | 64,29% | 100% |
| Carta d'identità italiana | 7 | 85,71% | 100% | 85,71% | 100% | 100% | 100% |
| Patente italiana | 8 | 62,5% | 100% | 62,5% | 100% | 50% | 100% |

Considerando l'intero insieme di categorie note di ciascun campo, Horizon restituisce un insieme esatto in **129 campi su 152**. Rizzo arriva a **110/152** e Presidio a **103/152**.

I risultati mostrano compromessi diversi:

- Horizon trova tutti i 9 IBAN con un falso positivo; Rizzo li trova tutti ma aggiunge 20 falsi positivi; Presidio ne trova 6 senza falsi positivi.
- Rizzo e Horizon trovano 61 persone su 63. Presidio ne trova 48 e aggiunge 18 falsi positivi.
- Presidio trova tutte le 7 carte d'identità; Rizzo e Horizon ne trovano 6.
- Sulle patenti, Rizzo e Horizon trovano 5 positivi su 8; Presidio ne trova 4.

Questi dati non definiscono da soli una scelta di prodotto. Il peso di una falsa accettazione e quello di un rifiuto ingiustificato dipendono dal processo che usa il servizio.

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

Il rerun funzionale finale usa immagini Docker con label OCI legata al commit applicativo `ce5d395`. Tutte le **33 prove** della suite di valutazione sono passate. Un verificatore dedicato ha confrontato i 60 casi esterni con i due Parquet fissati per revisione e SHA-256: testo, span e metadati selezionati coincidono per 60 casi su 60.

Il secondo run completo sulle immagini etichettate ha riprodotto byte per byte le sei esportazioni del primo run. Il bundle pubblicato esclude testi, span, score, note libere e body di errore.

Artefatti principali:

- [metodo e comandi](tests/evaluation/README.md);
- [report funzionale completo](tests/evaluation/results/main-2026-11-17/report.md);
- [risultati machine-readable](tests/evaluation/results/main-2026-11-17/results.json);
- [contesto, immagini e hash](tests/evaluation/results/main-2026-11-17/run-context.json);
- [Candidate A](tests/resources/results/phase-a-candidate-a-2026-11-16/report.md), [Candidate B](tests/resources/results/phase-b-candidate-b-2026-11-16/report.md) e [Candidate C](tests/resources/results/phase-c-candidate-c-2026-11-16/report.md).

## Attività ancora necessarie

La valutazione funzionale a tre motori è completa sul golden corrente. La caratterizzazione produttiva richiede ancora:

- curve open-loop omogenee al 50%, 75%, 100%, 125%, 150% e 200% della capacità stimata;
- run prolungati e cold start ripetuti;
- serie temporali di memoria, profondità della coda, CPU throttling ed event-loop lag;
- prove di recovery dopo burst, timeout, crash e OOM;
- una scelta verificata del routing quando una replica usa più processi.

Finché queste misure non saranno disponibili, i dati A/B/C restano screening tecnici e non una dichiarazione di capacità produttiva.