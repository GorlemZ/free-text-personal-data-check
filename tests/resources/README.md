# Benchmark risorse BardsAI

Risultati pubblicati:

- [ONNX intra-op 1](results/bardsai-v2-closed-open-2026-11-18/report.md): screening closed-loop e open-loop a 2 CPU e 4 GB; plateau closed-loop circa 8,7 risposte/s.
- [ONNX intra-op 2](results/bardsai-v2-intraop2-closed-open-2026-11-18/report.md): stesso workload e limiti; plateau closed-loop circa 15,1 risposte/s. La configurazione applicativa pubblicata resta intra-op 1.

## Harness opt-in

Il runner standard-library misura un'immagine BardsAI già costruita. Non scarica o costruisce immagini, non modifica il golden e non esegue benchmark durante `tests/run.py resources`.

```sh
python3 tests/resources/run.py \
  --gold tests/evaluation/gold.json \
  --cpus 2 --memory 4g --budget-seconds 300 \
  --image bardsai=YOUR_VERIFIED_BARDSAI_IMAGE \
  --output tests/resources/results/YOUR_NEW_RUN_ID
```

L'immagine viene risolta per ID e avviata con `--pull=never`, pubblicando il servizio su una porta dinamica loopback. Il modello deve essere già incluso nell'immagine. Il protocollo non isola l'egress del container: il test richiede quindi un'immagine verificata e un ambiente controllato.

## Protocollo

Il budget monotonic include startup, readiness, traffico, transizioni, recovery e cleanup. Il protocollo raccoglie idle, warm-up e livelli closed-loop a 1/2/4/8 client. Throughput e latenza usano soltanto risposte HTTP 200 conformi; errori, drain e timeout sono contati separatamente.

Il plateau richiede almeno 30 successi in-window, nessun errore, incremento di throughput non superiore al 10% al raddoppio dei client e p95 crescente. È una diagnostica esplorativa, non uno SLA.

## Telemetria

- `memory.current` e componenti cgroup;
- `memory.peak` quando esposto dal kernel;
- PID, parent, nome e RSS per processo;
- CPU cgroup, throttling e intervalli di campionamento;
- lifecycle, exit code, OOM e cleanup.

Docker Desktop ARM64 non espone `memory.peak` nell'ambiente usato per i risultati pubblicati. I massimi riportati sono campioni periodici, non picchi assoluti di vita del container.

Le prove pubblicate sono screening brevi locali. Servono misure su infrastruttura rappresentativa e soglie esplicite prima di derivare capacità produttiva.
