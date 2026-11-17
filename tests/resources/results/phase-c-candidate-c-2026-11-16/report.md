# Phase C — Candidate C two-process screening

Data del run: **16 novembre 2026**.

Candidate C usa due processi Node indipendenti, una sessione ONNX per processo, ORT intra-op/inter-op 1/1 e una richiesta attiva per worker. I due processi condividono lo stesso cgroup Docker limitato a 2 CPU e `4_000_000_000` byte. La capacità pending è due per worker, quattro complessive.

Questa fase verifica prima la fattibilità del doppio modello nel cap, poi isolamento, distribuzione, failure handling e screening a due client. **Non è ancora una curva open-loop di capacità sostenibile.**

## Configurazione

| Voce | Candidate C |
| --- | ---: |
| Processi Node | 2 |
| Sessioni modello | 2 |
| ORT intra-op per processo | 1 |
| ORT inter-op per processo | 1 |
| Richieste attive per processo | 1 |
| Pending per processo | 2 |
| Totale active/pending | 2/4 |
| Attesa massima pending | 500 ms |
| CPU del cgroup condiviso | 2 |
| RAM del cgroup condiviso | `4_000_000_000` byte |
| `cpu.max` osservato | `200000 100000` |
| `memory.max` osservato | `3999997952` byte |

Ogni worker è stato avviato con configurazione esplicita:

```text
ANALYZER_CONCURRENCY=1
ANALYZER_MAX_PENDING_REQUESTS=2
ANALYZER_MAX_QUEUE_WAIT_MS=500
```

Sono state riutilizzate le immagini Candidate B, perché contengono già ORT 1/1; la topologia e i limiti Candidate C sono applicati all'avvio:

| Motore | Image ID |
| --- | --- |
| Horizon | `sha256:4eabd79729eae0f0987f1f8f4dfa31e171ca238c9f1d770b867004db0e2121c1` |
| Rizzo | `sha256:d67f9c415d9aa9c8722df57f7f9bcfa77c767983064c4afcf2d763642b97934f` |

## Gate di fattibilità RAM

### Horizon

Entrambi i processi sono diventati ready sotto il cap. Subito dopo il caricamento `memory.current` era `3.993.735.168` byte (3.808,7 MiB), con circa 6,3 MB di margine rispetto a `memory.max`. Due richieste simultanee hanno completato con HTTP 200; dopo 40 risposte simultanee il campione era `3.508.142.080` byte (3.345,6 MiB), senza eventi OOM.

La vicinanza iniziale al cap è un rischio operativo: il campionamento puntuale non garantisce che ogni cold start o versione del runtime mantenga lo stesso margine.

### Rizzo

Candidate C è **esclusa per Rizzo**. Durante il caricamento simultaneo delle due sessioni, un worker è stato terminato dal cgroup prima che entrambi diventassero ready:

```text
memory.events: max 5703, oom 2, oom_kill 1
```

Il container supervisor è rimasto attivo con un solo worker e `memory.current=3.889.803.264` byte. Non sono stati eseguiti gate o benchmark Candidate C su Rizzo dopo l'OOM. Il cap non è stato aumentato.

## Gate Horizon: isolamento e distribuzione

[`process-parity.mjs`](process-parity.mjs) confronta quattro baseline fra i due processi, poi esegue 20 coppie simultanee, 40 risposte complessive, con assegnazione bilanciata. Esegue infine un overflow token su un worker mentre l'altro serve una richiesta valida.

| Verifica | Risultato |
| --- | --- |
| Baseline equivalenti fra processi | 4/4 |
| Risposte simultanee equivalenti | 40/40 |
| Distribuzione diretta | 20/20 per worker |
| Overflow token | Worker 1: `503 detector_unavailable` |
| Richiesta valida contemporanea | Worker 2: 200, identica alla baseline |

Non è stata osservata contaminazione fra processi.

## Gate Horizon: routing e worker failure

[`cluster-router.mjs`](cluster-router.mjs) è un router esterno di benchmark, non codice di produzione. Prima del failure, [`router-gate.mjs`](router-gate.mjs) ha osservato:

```json
{"readiness":200,"responses":4,"workers":[1,2,1,2]}
```

Dopo `SIGTERM` al worker 1:

```json
{"readiness":503,"responses":4,"workers":[2,2,2,2]}
```

Il worker 2 è rimasto ready e ha servito tutte le richieste; il container non è terminato e `oom_kill` è rimasto zero. La readiness aggregata è correttamente passata a 503 perché la replica non aveva più la capacità Candidate C completa.

Questo gate prova il comportamento del router di benchmark. Non certifica una configurazione Kubernetes, sidecar o load balancer di produzione.

## Screening Horizon a due client

[`calibration.mjs`](calibration.mjs) ha inviato sei warm-up e 30 richieste misurate, 15 per worker, per un totale di 121 campi. Il throughput usa il tempo wall-clock del batch; le latenze sono end-to-end per richiesta.

| HTTP 200 | req/s | campi/s | p50 | p90 | p95 | p99 | max |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 30/30 | 6,78 | 27,35 | 96,2 ms | 469,6 ms | 483,5 ms | 812,1 ms | 812,1 ms |

Horizon Candidate C raggiunge il target preliminare p90 sotto 500 ms in questo singolo screening. Il p99 resta 812,1 ms.

Il throughput è circa il 78,4% dello screening seriale Candidate A e il 132,5% dello screening Candidate B. I confronti sono diagnostici: A usava un solo client, B/C due client e nessuna configurazione dispone ancora di curve open-loop replicate.

Dopo parità e calibrazione:

```text
memory.current  3.223.203.840 B (3.073,9 MiB)
memory.stat anon  3.014.615.040 B
memory.stat file    194.260.992 B
worker RSS       ~1.538.104 KiB e ~1.540.508 KiB
worker threads   11 ciascuno
memory.events    max 0, oom 0, oom_kill 0
```

I valori RSS si sovrappongono in parte con pagine condivise e non vanno sommati per ricostruire `memory.current`.

## Riproduzione

Esempio Horizon con due processi nello stesso cgroup:

```sh
docker run --rm \
  --cpus=2 \
  --memory=4000000000 \
  --memory-swap=4000000000 \
  -e ANALYZER_BIND_HOST=0.0.0.0 \
  -e ANALYZER_CONCURRENCY=1 \
  -e ANALYZER_MAX_PENDING_REQUESTS=2 \
  -e ANALYZER_MAX_QUEUE_WAIT_MS=500 \
  -p 127.0.0.1:18082:8001 \
  -p 127.0.0.1:18083:8002 \
  free-text-check:horizon-phase-b \
  sh -c 'ANALYZER_PORT=8001 node dist/index.js & ANALYZER_PORT=8002 node dist/index.js & wait'
```

Eseguire i gate diretti:

```sh
node tests/resources/results/phase-c-candidate-c-2026-11-16/process-parity.mjs \
  http://127.0.0.1:18082 http://127.0.0.1:18083 horizon
node tests/resources/results/phase-c-candidate-c-2026-11-16/calibration.mjs \
  http://127.0.0.1:18082 http://127.0.0.1:18083 horizon
```

Il router di benchmark è intenzionalmente esterno al cgroup dei worker e non è incluso nelle misure di memoria della replica:

```sh
node tests/resources/results/phase-c-candidate-c-2026-11-16/cluster-router.mjs \
  18084 http://127.0.0.1:18082 http://127.0.0.1:18083
```

## Gate di repository

Candidate C non modifica codice di produzione: applica configurazione e topologia tramite variabili e processi separati. Sono stati comunque rieseguiti i gate completi:

- Horizon: **130/130** test;
- Rizzo: **157/157** test;
- contratto condiviso: **342/342** test;
- `pnpm check`: passato;
- `git diff --check`: passato.

## Review indipendente

La review finale è passata senza finding di sicurezza, logica o prova. Ha confermato la coerenza di calcoli, arrotondamenti, script e caveat; ha inoltre confermato che l'esclusione Rizzo è giustificata dall'OOM del cgroup e che Horizon non deve essere promossa sulla base di un margine cold-start di circa 6,3 MB e di un solo run breve closed-loop.

Due miglioramenti non bloccanti restano per le campagne future:

- archiviare stdout e snapshot cgroup machine-readable di ogni run;
- aggiungere al router di benchmark limite del body e timeout upstream, per evitare che input accidentali o un worker bloccato sospendano il gate.

## Limiti e decisione preliminare

- Rizzo è esclusa per OOM durante il doppio caricamento.
- Horizon ha un margine cold-start iniziale molto ridotto, non ancora accettabile senza run ripetuti e misura del picco.
- Router esterno di benchmark, non configurazione di produzione certificata.
- Screening breve closed-loop con un solo run.
- Nessuna curva open-loop 50–200%, queue-depth series, CPU throttling o event-loop lag.
- Nessun run prolungato per leak, OOM/recovery o variabilità del cold start.
- Il kill gate usa `SIGTERM`, non crash nativo o OOM del worker Horizon.
- Modello, tokenizer, precisione, soglie, output e contratto HTTP sono invariati.

Candidate C è **non deployabile per Rizzo** entro 2 CPU/4 GB. Per Horizon supera il gate funzionale e il target p90 dello screening, ma non viene ancora promossa: servono curve open-loop, cold-start ripetuti e una scelta verificata del routing di produzione.
