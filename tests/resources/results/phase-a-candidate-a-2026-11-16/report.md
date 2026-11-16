# Phase A — Candidate A resource screening

Data del run: **16 novembre 2026**.

Questa è una misura preliminare di una singola replica per Horizon e Rizzo. Verifica che Candidate A sia eseguibile entro il limite assegnato e fornisce una prima misura seriale; **non determina la capacità produttiva sostenibile** e non sostituisce il benchmark open-loop pianificato.

## Configurazione verificata

| Voce | Candidate A |
| --- | ---: |
| Processi per replica | 1 |
| Sessioni modello per processo | 1 |
| CPU assegnate | 2 |
| RAM Docker | `4_000_000_000` byte |
| `cpu.max` osservato | `200000 100000` |
| `memory.max` osservato | `3999997952` byte |
| ORT intra-op threads | 2 |
| ORT inter-op threads | 1 |
| Richieste attive | 1 |
| Richieste pending | 4 |
| Attesa massima pending | 500 ms |

Variabili runtime:

```text
ANALYZER_CONCURRENCY=1
ANALYZER_MAX_PENDING_REQUESTS=4
ANALYZER_MAX_QUEUE_WAIT_MS=500
```

La coda è FIFO e bounded. L'overflow e la scadenza pending conservano il contratto esistente e restituiscono `503 detector_unavailable`. Una richiesta scaduta viene rimossa immediatamente e non esegue inferenza; il timeout viene disarmato quando il lavoro ottiene lo slot attivo.

## Metodo dello screening

Per ogni motore è stata costruita un'immagine dai sorgenti locali di Candidate A e avviata in un container nuovo con limiti espliciti:

```sh
docker run --cpus=2 \
  --memory=4000000000 \
  --memory-swap=4000000000 \
  -e ANALYZER_CONCURRENCY=1 \
  -e ANALYZER_MAX_PENDING_REQUESTS=4 \
  -e ANALYZER_MAX_QUEUE_WAIT_MS=500 \
  IMAGE
```

Dopo la readiness sono state inviate 5 richieste di warm-up e 30 richieste seriali, alternando payload sintetici da 1, 1, 5 e 10 campi. Le 30 richieste misurate contengono complessivamente 121 campi. Il client usato è versionato in [`calibration.mjs`](calibration.mjs).

Le metriche di latenza sono misure end-to-end del client. Il throughput è `richieste / somma delle latenze`, appropriato a questo screening seriale closed-loop. La memoria è `memory.current` del cgroup del container, non la somma degli RSS.

## Risultati

| Motore | HTTP 200 | Campi | req/s | campi/s | p90 | p95 | Memoria loaded | Memoria post-load |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Horizon | 30/30 | 121 | 8,65 | 34,88 | 267,3 ms | 271,1 ms | 2.217.000.960 B (2.114,3 MiB) | 2.304.770.048 B (2.198,0 MiB) |
| Rizzo | 30/30 | 121 | 6,84 | 27,59 | 313,2 ms | 346,6 ms | 1.978.081.280 B (1.886,4 MiB) | 2.307.670.016 B (2.200,8 MiB) |

In questo singolo screening Horizon ha ottenuto un throughput pari a circa **1,264×** quello di Rizzo. La differenza non è una graduatoria produttiva: manca una prova open-loop replicata e i payload sono sintetici.

Entrambi i motori sono rimasti sotto il cap assegnato durante la breve osservazione. Questo dimostra soltanto l'eseguibilità dello scenario osservato; non stabilisce RAM minima, assenza di leak o stabilità prolungata.

## Gate funzionali e review

Prima della pubblicazione della configurazione Candidate A sono stati verificati:

- Horizon: **130/130** test;
- Rizzo: **157/157** test;
- contratto condiviso: **342/342** test;
- `pnpm check`: passato;
- `git diff --check`: passato;
- review indipendente finale: passata senza finding di sicurezza o logica.

La review ha controllato i default condivisi 1 active/4 pending/500 ms, FIFO, rilascio della capacità dopo successo o errore, rimozione delle entry scadute, disarmo del timer all'avvio, mapping HTTP 503, validazione/configurazione di entrambi i motori e opzioni ORT 2/1.

## Riproduzione dello screening

Costruire le immagini dalla radice del repository:

```sh
docker build -f poc-horizon/Dockerfile -t free-text-check:horizon-phase-a .
docker build -f poc-rizzo/Dockerfile -t free-text-check:rizzo-phase-a .
```

Avviare un motore alla volta con i limiti sopra indicati, pubblicando la porta HTTP su loopback, quindi eseguire:

```sh
node tests/resources/results/phase-a-candidate-a-2026-11-16/calibration.mjs \
  http://127.0.0.1:PORT ENGINE
```

Il client stampa JSON su stdout. Per una riproduzione auditabile vanno registrati anche commit, ID immutabile dell'immagine, versione Docker, ambiente host e campioni cgroup. Lo screening originale non ha conservato gli ID immutabili delle immagini né il JSON grezzo: le metriche sopra sono quindi una sintesi versionata, non un receipt crittograficamente attestato.

## Limiti e lavoro residuo

- Carico seriale closed-loop, non open-loop.
- Un solo run breve per motore, senza repliche statistiche.
- Nessuna curva al 50%, 75%, 100%, 125%, 150% e 200% della capacità stimata.
- Nessuna conclusione su p99 sostenibile, crescita della coda, recovery post-burst, OOM o leak.
- Candidate B e C non sono state eseguite.
- In Node CPU-bound il timer pending dipende dall'event loop: impedisce best-effort l'avvio di lavoro stale, ma non garantisce una risposta HTTP esattamente entro 500 ms.
- La rimozione immediata dalla coda quando il client si disconnette resta lavoro residuo; un task già attivo non viene cancellato.
- Modello, tokenizer, precisione, soglie, output e contratto HTTP non sono stati modificati per questo screening.

La decisione sulla configurazione produttiva richiede ancora il protocollo open-loop completo e il confronto con Candidate B/C entro lo stesso envelope di 2 CPU e 4 GB per replica.
