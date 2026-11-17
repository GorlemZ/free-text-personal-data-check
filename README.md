# Controllo dei dati personali nei campi liberi

Stato al 17 novembre 2026.

## Stato attuale

Tre prototipi (PoC) confrontano il riconoscimento di dati personali nei testi liberi. Condividono il contratto business e le categorie considerate: per ogni campo si indicano le categorie consentite; le altre categorie rilevate causano il rifiuto della richiesta. I criteri di riconoscimento restano specifici di ogni motore.

| PoC      | Come riconosce i dati                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Rizzo    | Modello per i dati personali, con regole integrative per categorie non coperte |
| Horizon  | Modello più compatto, con regole integrative per categorie non coperte         |
| Presidio | Libreria di riconoscimento con un modello per la lingua italiana               |

L'elaborazione avviene localmente. Rizzo e Horizon hanno sorgenti TypeScript compilati in JavaScript e usano Transformers.js; Presidio usa Python. I due servizi Node condividono `@pagopa/detector-http`, il package infrastrutturale che monta routing Express, abilita il parser JSON standard con limite 1 MiB, valida la porta e gestisce listen/segnali/shutdown. Entrambi validano `req.body` con Zod e delegano a Express la serializzazione JSON. Service, adapter e dominio restano nei rispettivi PoC.

Il refactor di Rizzo e Horizon usa l'inferenza come fonte primaria, senza veto basati sugli offset o controlli strutturali aggiuntivi sulle predizioni. Le regole integrano soltanto categorie non coperte dal modello. Il budget di token, le analisi contemporanee e la coda pending sono configurabili. Candidate B ammette di default due richieste attive e quattro pending in FIFO per un massimo di 500 ms; overflow e scadenza mantengono il `503 detector_unavailable` esistente. Il parsing JSON standard conserva l'ultimo valore delle chiavi duplicate; gli identificatori di campo duplicati restano vietati.

## Valutazione funzionale aggiornata

Il **17 novembre 2026** abbiamo valutato Rizzo, Horizon e Presidio sul commit applicativo **`ce5d395818760f73e1ea17879d22cb158295f110`**, con inferenza reale in container Docker e richieste HTTP. Il gold esteso, le annotazioni e la policy sono stati congelati prima delle predizioni.

Il campione comprende **151 scenari, 152 campi e 142 testi distinti**. Sono state completate **906 richieste su 906**, senza errori tecnici o contrattuali e senza retry selettivi: una richiesta di detection con tutte le categorie vietate e una richiesta con la policy annotata per ogni scenario e motore.

### Correttezza dei verdetti

Il gold prevede **98 rifiuti e 53 accettazioni**. La tabella usa i verdetti HTTP effettivi delle richieste policy.

| PoC      | Decisioni corrette | Accettate per errore (su 98) | Rifiutate per errore (su 53) |
| -------- | -----------------: | ---------------------------: | ---------------------------: |
| Rizzo    |             89,40% |                    4 — 4,08% |                  12 — 22,64% |
| Horizon  |             94,70% |                    1 — 1,02% |                   7 — 13,21% |
| Presidio |             78,81% |                  20 — 20,41% |                  12 — 22,64% |

Horizon ha la maggiore accuratezza del verdetto in questo campione e il minor numero di false accettazioni. Ignorando le 13 coppie annotate come ambigue, restituisce l'insieme esatto delle categorie note in **129/152 campi**, contro **110/152** di Rizzo e **103/152** di Presidio. Un rifiuto corretto può comunque essere causato da una categoria sbagliata: la correttezza del verdetto non sostituisce quella della detection.

### Sensibilità e precisione per categoria

La **sensibilità** misura quanti positivi attesi vengono individuati; la **precisione** quante segnalazioni sono corrette. L'unità di misura è la presenza della categoria nel campo, non il numero di entità o l'accuratezza degli span. Le coppie ambigue sono escluse dai conteggi detection, senza essere considerate errori; la policy è decidibile per tutti gli scenari.

| Categoria                 | Positivi | Rizzo sens. | Rizzo prec. | Horizon sens. | Horizon prec. | Presidio sens. | Presidio prec. |
| ------------------------- | -------: | -----------: | -----------: | ------------: | ------------: | -------------: | -------------: |
| Persona                   |       63 |       96,83% |       96,83% |        96,83% |        98,39% |         76,19% |         72,73% |
| Email                     |       24 |         100% |           96% |          100% |           96% |           100% |           100% |
| Telefono                  |       20 |          80% |           80% |          100% |           80% |            85% |            85% |
| Codice fiscale            |       17 |         100% |           85% |          100% |          100% |           100% |           100% |
| Partita IVA               |       10 |          40% |       44,44% |          100% |        90,91% |            70% |          87,5% |
| IBAN                      |        9 |         100% |       31,03% |          100% |           90% |         66,67% |           100% |
| Carta di credito          |       14 |         100% |       73,68% |          100% |        63,64% |         64,29% |           100% |
| Carta d'identità italiana |        7 |       85,71% |          100% |        85,71% |          100% |           100% |           100% |
| Patente italiana          |        8 |        62,5% |          100% |         62,5% |          100% |            50% |           100% |

I principali compromessi osservati sono:

- **Verdetto:** Horizon accetta per errore 1 scenario da rifiutare; Rizzo 4; Presidio 20.
- **IBAN:** Rizzo trova tutti i 9 positivi ma aggiunge 20 falsi positivi; Horizon trova tutti i 9 con 1 falso positivo; Presidio ne trova 6 senza falsi positivi.
- **Persone:** Presidio trova 48 positivi su 63 e produce 18 falsi positivi; Rizzo e Horizon ne trovano 61, rispettivamente con 2 e 1 falsi positivi.
- **Documenti:** Presidio trova tutte le 7 carte d'identità, mentre Rizzo e Horizon ne trovano 6; sulle patenti i tre motori ne trovano rispettivamente 5, 5 e 4 su 8.

Il confronto resta descrittivo: la scelta dipende dal costo relativo di dati non riconosciuti e blocchi ingiustificati.

### Limiti e verifica del run

Il campione è di sviluppo, **non held-out**, e contiene scenari correlati e testi riutilizzati. La detection viene ripetuta per scenario; le percentuali non dimostrano generalizzazione o adeguatezza alla produzione. La geografia prevista dal gold per telefoni e documenti è italiana: il confronto misura il comportamento delle pipeline, comprese eventuali segnalazioni più ampie del modello.

Il [report completo](tests/evaluation/results/main-2026-11-17/report.md), il [bundle JSON](tests/evaluation/results/main-2026-11-17/results.json) e il [contesto del run](tests/evaluation/results/main-2026-11-17/run-context.json) conservano matrici, copertura, digest delle immagini e hash degli artefatti. La rigenerazione offline delle sei esportazioni ha prodotto file byte-identici. Il bundle esclude testi, span, score, note libere e body di errore.

Le immagini sono state costruite dai Dockerfile correnti; l'inferenza ha usato asset locali. Le build possono usare la rete per le dipendenze e non viene dichiarato isolamento di rete dei container. I container del run sono stati rimossi. Il run funzionale non misura throughput, latenza o memoria.

## Memoria e capacità

Candidate A è stata verificata su Horizon e Rizzo con una replica limitata a 2 CPU e `4_000_000_000` byte, ORT intra-op 2/inter-op 1, una richiesta attiva e quattro pending. Nello screening seriale preliminare Horizon ha elaborato 8,65 req/s con p95 271,1 ms e circa 2.198,0 MiB post-load; Rizzo 6,84 req/s con p95 346,6 ms e circa 2.200,8 MiB post-load. Entrambi hanno completato 30/30 richieste.

Le prove open-loop sul corpus gold hanno dato un risultato diverso. Horizon è andato in timeout durante la stabilizzazione a 4,325 req/s; a 1 e 0,5 req/s ha completato senza errori, con p90 rispettivamente di 807 e 803 ms. Rizzo ha completato a 3,42, 1 e 0,5 req/s senza errori, con p90 di 957, 648 e 599 ms. Nessun punto testato ha soddisfatto il criterio p90 < 500 ms. Il protocollo ha quindi fermato i livelli superiori e non ha avviato soak o burst/recovery. A 0,5 req/s entrambi i motori avevano al massimo una richiesta in volo: la coda non spiega il superamento del target in quel campione.

Il [report open-loop Candidate A](tests/resources/results/open-loop-candidate-a-2026-11-17/report.md) conserva metodo, risultati, limiti e tentativi parziali. Il [report dello screening Candidate A](tests/resources/results/phase-a-candidate-a-2026-11-16/report.md) resta il riferimento per il confronto preliminare closed-loop. Le prove disponibili descrivono il carico osservato; cold start ripetuti e stabilità prolungata richiedono una nuova campagna dopo una decisione sul target di latenza o sul carico.

Candidate B usa una sessione ONNX condivisa con intra-op/inter-op 1/1 e due richieste attive. Il gate di isolamento reale è passato su entrambi i motori, ma lo screening preliminare a due client ha superato il target p90: Horizon 5,12 req/s e p90 752,6 ms; Rizzo 5,02 req/s e p90 789,7 ms. Il [report Candidate B](tests/resources/results/phase-b-candidate-b-2026-11-16/report.md) conserva risultati e caveat; le curve open-loop restano necessarie prima di una decisione finale.

Candidate C usa due processi/sessioni con intra-op/inter-op 1/1, una richiesta attiva e due pending per worker nello stesso cgroup 2 CPU/4 GB. Rizzo è esclusa perché il secondo modello ha causato un OOM kill durante il caricamento. Horizon ha completato lo screening con 6,78 req/s e p90 469,6 ms, ma il cold start ha raggiunto 3.993.735.168 byte: il margine è troppo ridotto per promuoverla senza prove open-loop e cold-start ripetuti. Dettagli nel [report Candidate C](tests/resources/results/phase-c-candidate-c-2026-11-16/report.md).

### Misure storiche

Le misure seguenti precedono le nuove versioni e **non ne certificano il consumo**. Rizzo e Horizon avevano completato una prova con 4 GB disponibili e 30 richieste ciascuno; Presidio era stato misurato con un carico diverso.

| PoC      | Massimo di RAM osservato nella prova storica | Esito storico                                                         |
| -------- | -------------------------------------------: | --------------------------------------------------------------------- |
| Rizzo    |                                Circa 4,00 GB | Vicino al limite; nella prova a 2 GB l'avvio non era stato completato |
| Horizon  |                                Circa 2,36 GB | Test a 4 GB completato                                                |
| Presidio |                                Circa 0,16 GB | Misura precedente con carico diverso                                  |

Sono massimi campionati dell'intero container in prove brevi e non omogenee e non vanno confrontati direttamente con Candidate A. Il run funzionale non è un benchmark di risorse.

## Guide e utilizzo

- [Report di valutazione per stakeholder tecnici e funzionali](REPORT.md).
- PoC: [Rizzo](poc-rizzo/README.md), [Horizon](poc-horizon/README.md), [Presidio](poc-presidio/README.md).
- [Installazione e test](tests/README.md).
- [Interfaccia comune](tests/contract/README.md).
- [Metodo e limiti dei test sulle risorse](tests/resources/README.md).

I PoC sono per prove locali con dati di test. Prima dell'integrazione servono accessi controllati, rete protetta e regole sui dati consentiti definite da una fonte fidata. Alcuni dati personali possono sfuggire anche con un esito di accettazione.
