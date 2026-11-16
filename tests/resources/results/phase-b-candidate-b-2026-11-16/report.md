# Phase B — Candidate B shared-session screening

Data del run: **16 novembre 2026**.

Candidate B usa un solo processo e una sola sessione ONNX con due richieste attive. Questa prova verifica prima l'isolamento funzionale della sessione condivisa e poi esegue uno screening closed-loop a due client entro il limite di 2 CPU e `4_000_000_000` byte. **Non è ancora un benchmark open-loop di capacità sostenibile.**

## Configurazione

| Voce | Candidate B |
| --- | ---: |
| Processi per replica | 1 |
| Sessioni modello | 1 |
| ORT intra-op threads | 1 |
| ORT inter-op threads | 1 |
| Richieste attive | 2 |
| Richieste pending | 4 |
| Attesa massima pending | 500 ms |
| CPU Docker | 2 |
| RAM Docker | `4_000_000_000` byte |
| `cpu.max` osservato | `200000 100000` |
| `memory.max` osservato | `3999997952` byte |

Variabili runtime esplicite:

```text
ANALYZER_CONCURRENCY=2
ANALYZER_MAX_PENDING_REQUESTS=4
ANALYZER_MAX_QUEUE_WAIT_MS=500
```

Immagini costruite dai sorgenti del branch `benchmark/phase-b`:

| Motore | Image ID |
| --- | --- |
| Horizon | `sha256:4eabd79729eae0f0987f1f8f4dfa31e171ca238c9f1d770b867004db0e2121c1` |
| Rizzo | `sha256:d67f9c415d9aa9c8722df57f7f9bcfa77c767983064c4afcf2d763642b97934f` |

## Gate di isolamento della sessione condivisa

Il client [`concurrency-parity.mjs`](concurrency-parity.mjs) ha costruito quattro baseline seriali distinte da 1, 1, 5 e 10 campi, poi ha confrontato 20 coppie simultanee, 40 risposte complessive, con le rispettive baseline. Ha infine eseguito in parallelo una richiesta valida M10 e una richiesta che supera il budget di token.

| Motore | Baseline seriali | Coppie simultanee | Risposte equivalenti | Fallimento isolato | Valida accanto al fallimento |
| --- | ---: | ---: | ---: | --- | --- |
| Horizon | 4 | 20 | 40/40 | `503 detector_unavailable` | 200, identica alla baseline |
| Rizzo | 4 | 20 | 40/40 | `503 detector_unavailable` | 200, identica alla baseline |

Il gate non ha rilevato contaminazione fra richieste o non determinismo dell'output pubblico. Prova l'isolamento per i casi eseguiti, non l'assenza universale di race nel runtime nativo.

## Screening a due client

Il client [`calibration.mjs`](calibration.mjs) ha inviato sei richieste di warm-up e 30 richieste misurate con due client closed-loop. La sequenza alterna profili sintetici da 1, 1, 5 e 10 campi; il campione misurato contiene 121 campi. Il throughput usa il tempo wall-clock dell'intero batch, mentre le latenze sono end-to-end per richiesta.

| Motore | HTTP 200 | req/s | campi/s | p50 | p90 | p95 | p99 | max |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Horizon | 30/30 | 5,12 | 20,64 | 179,8 ms | 752,6 ms | 877,4 ms | 878,2 ms | 878,2 ms |
| Rizzo | 30/30 | 5,02 | 20,26 | 182,1 ms | 789,7 ms | 887,7 ms | 893,4 ms | 893,4 ms |

Candidate B **non raggiunge il target p90 sotto 500 ms** in questo screening a due client. Non viene quindi dichiarata capacità produttiva conforme.

Rispetto allo screening seriale Candidate A, il throughput osservato di Candidate B è circa il 59,2% per Horizon e il 73,5% per Rizzo. Il confronto è diagnostico: i client closed-loop differiscono intenzionalmente fra le topologie e mancano repliche e curve open-loop.

## Memoria osservata

`memory.peak` non è esposto dal cgroup Docker Desktop usato; sono stati letti campioni puntuali di `memory.current` dopo il gate di parità e dopo la calibrazione.

| Motore | Dopo parità | Dopo calibrazione | Massimo campione osservato |
| --- | ---: | ---: | ---: |
| Horizon | 2.363.596.800 B (2.254,1 MiB) | 1.874.718.720 B (1.787,9 MiB) | 2.363.596.800 B |
| Rizzo | 2.947.964.928 B (2.811,4 MiB) | 2.962.227.200 B (2.825,0 MiB) | 2.962.227.200 B |

Entrambi i motori sono rimasti sotto `memory.max` nei campioni osservati e non hanno riportato OOM. I campioni puntuali non escludono picchi intermedi, crescita lenta o leak.

## Gate di repository

- Horizon: **130/130** test;
- Rizzo: **157/157** test;
- contratto condiviso: **342/342** test;
- `pnpm check`: passato;
- `git diff --check`: passato.

## Review indipendente

La review finale sul diff Candidate B è passata senza finding di sicurezza o logica. Ha confermato:

- default produttivi 2 active, 4 pending e 500 ms;
- ORT intra-op/inter-op 1/1 per entrambi i motori;
- nessuna modifica involontaria a contratto HTTP, output, modello, tokenizer, precisione, soglie o budget token;
- coerenza fra script, risultati registrati e valori riportati in questo documento;
- copertura shared-session con quattro baseline seriali, 20 coppie simultanee/40 risposte e isolamento dell'overflow token.

Il reviewer ha rieseguito con successo Horizon 130/130, Rizzo 157/157, contract 342/342, `pnpm check` e `git diff --check`.

## Riproduzione

```sh
docker build -f poc-horizon/Dockerfile -t free-text-check:horizon-phase-b .
docker build -f poc-rizzo/Dockerfile -t free-text-check:rizzo-phase-b .
```

Avviare un'immagine alla volta con:

```sh
docker run --rm \
  --cpus=2 \
  --memory=4000000000 \
  --memory-swap=4000000000 \
  -e ANALYZER_CONCURRENCY=2 \
  -e ANALYZER_MAX_PENDING_REQUESTS=4 \
  -e ANALYZER_MAX_QUEUE_WAIT_MS=500 \
  -p 127.0.0.1:PORT:8000 IMAGE
```

Poi eseguire:

```sh
node tests/resources/results/phase-b-candidate-b-2026-11-16/concurrency-parity.mjs \
  http://127.0.0.1:PORT ENGINE
node tests/resources/results/phase-b-candidate-b-2026-11-16/calibration.mjs \
  http://127.0.0.1:PORT ENGINE
```

Per Horizon occorre anche `ANALYZER_BIND_HOST=0.0.0.0`; per Rizzo `BIND_HOST=0.0.0.0`.

## Limiti e decisione preliminare

- Screening breve closed-loop con un solo run per motore.
- Nessuna curva open-loop 50–200%, finestra di stabilizzazione o conferma.
- Nessuna misura affidabile di `memory.peak`, CPU utilizzata/throttling, queue depth o event-loop lag.
- Nessuna prova prolungata di recovery, leak o OOM.
- Il fallimento affiancato è un overflow del budget token, non un crash nativo ONNX.
- Candidate C non è ancora stata eseguita.
- Modello, tokenizer, precisione, soglie, output e contratto HTTP sono invariati.

Candidate B passa il gate funzionale shared-session, ma lo screening prestazionale preliminare è peggiore di Candidate A per entrambi i motori e viola il target p90. La raccomandazione finale resta sospesa fino alle curve open-loop omogenee e a Candidate C.
