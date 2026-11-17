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

## Valutazione funzionale corrente — 17 novembre 2026

Il golden `category-detection-1` contiene **142 testi autonomi** e le sole categorie attese. Ogni testo viene inviato una volta a ciascun motore con tutte le categorie vietate. Il bundle pubblicato contiene **426 osservazioni complete**, senza errori tecnici o contrattuali; il runner non esegue retry. La migrazione non modifica codice o configurazione dei servizi.

### Correttezza dei verdetti e del body

Il golden prevede 99 rifiuti e 43 accettazioni. Il verdetto è quello restituito nel body HTTP; `body esatto` richiede anche findings e categorie identici all'oracolo.

| PoC | Verdetti corretti | TP | FP | FN | TN | Body esatti |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Rizzo | 131/142 — 92,25% | 97 | 9 | 2 | 34 | 113/142 |
| Horizon | 135/142 — 95,07% | 98 | 6 | 1 | 37 | 122/142 |
| Presidio | 114/142 — 80,28% | 79 | 8 | 20 | 35 | 101/142 |

Horizon ha il maggior numero di verdetti corretti e di body esatti in questo campione. La correttezza del solo verdetto resta distinta dalla correttezza delle categorie: un rifiuto può essere causato da una categoria diversa da quella attesa.

### Metodo e limiti

La metrica misura la presenza della categoria nel testo, non il numero di entità o gli span. Il corpus conserva positivi, negativi, near-miss, identificativi riconoscibili con checksum errato, overlap e formati insoliti. Non misura policy con allowlist non vuote, error handling, limiti, memoria o prestazioni.

Il campione è di sviluppo e **non held-out**. Le percentuali descrivono questi 142 testi e non attestano generalizzazione o rappresentatività produttiva. Un verdetto `accepted` non prova l'assenza di dati personali.

Il [metodo di valutazione](tests/evaluation/README.md), il [report completo](tests/evaluation/results/category-detection-v3-2026-11-17/report.md) e il [bundle JSON](tests/evaluation/results/category-detection-v3-2026-11-17/results.json) contengono matrici, differenze e osservazioni sanificate. Il bundle esclude testi, provenance, span, score, note libere e body di errore. La rigenerazione offline dei sei file è byte-identica. I container usati dal run sono stati rimossi.

## Memoria e capacità

Candidate A è stata verificata su Horizon e Rizzo con una replica limitata a 2 CPU e `4_000_000_000` byte, ORT intra-op 2/inter-op 1, una richiesta attiva e quattro pending. Nello screening seriale preliminare Horizon ha elaborato 8,65 req/s con p95 271,1 ms e circa 2.198,0 MiB post-load; Rizzo 6,84 req/s con p95 346,6 ms e circa 2.200,8 MiB post-load. Entrambi hanno completato 30/30 richieste.

Il [report Candidate A](tests/resources/results/phase-a-candidate-a-2026-11-16/report.md) contiene configurazione, metodo, gate e limiti. È uno screening breve closed-loop: non certifica capacità produttiva, RAM minima o stabilità prolungata; restano da eseguire le curve open-loop e il confronto Candidate B/C.

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
