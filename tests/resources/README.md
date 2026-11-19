# Benchmark risorse dei quattro detector

[Indice dei risultati pubblicati](results/README.md) · [Test e valutazione](../README.md)

I due runner sono **opt-in**: `python3 tests/run.py resources` usa soltanto server finti e non avvia inferenza Docker. Prima di una run reale, verificare immagini e modelli locali, provenienza delle build, spazio Docker e assenza di container concorrenti. Gli image ID salvati nei receipt identificano le immagini usate, ma da soli non attestano la revisione dei sorgenti con cui sono state costruite. Non eseguire prune di dati altrui.

## Screening per lunghezza: `length_benchmark.py`

Fasce A/B/C/D: **10/50/150/1000 caratteri ASCII**, tre casi deterministici per fascia, un campo per POST, tre warm-up e 60 richieste misurate. Client closed-loop: la richiesta successiva parte dopo la risposta precedente. Il modello è già caricato durante la misura. Senza selezione il runner esegue A→B→C→D; `--bands A,B,C` limita la run alle prime tre fasce, `--band D` alla sola D. `--engine bardsai` (o un altro motore) seleziona un solo PoC.

```sh
python3 tests/resources/length_benchmark.py \
  --count 60 --output tests/resources/results/length/NUOVA_CAMPAGNA
```

Ogni motore usa un container nuovo con modello già incluso, 1 CPU, 4 GiB, swap limitato come la RAM e budget nominale di 300 s; il preflight rifiuta container estranei attivi, espone solo una porta host loopback e il motore successivo parte dopo cleanup verificato. Il recupero d'emergenza può oltrepassare il budget e lasciare una run parziale. I tre motori ONNX usano intra/inter-op 1/1 e `ANALYZER_CONCURRENCY=1`; Presidio usa spaCy e OMP/BLAS=1, con serialità garantita dal client. La fascia D usa 50 parole sintetiche più lunghe per rispettare il limite HTTP di 50 parole: anche la tokenizzazione cambia rispetto ad A/B/C. Un run di una sola fascia ha uno stato iniziale diverso da una sequenza A→B→C→D. I [report A/B/C e D](results/README.md) restano separati.

Throughput = risposte HTTP 200 conformi / durata del ciclo, inclusi i controlli client; p50/p95 usano le sole risposte riuscite. CPU media: delta cgroup sul bracket di telemetria, incluso l'osservatore. RAM: massimo **campionato** di `memory.current` agli estremi e durante la fascia; `memory.peak`, quando disponibile, è cumulativo dall'avvio del container. Una fascia breve può non avere campioni durante i POST. Questo screening warm e seriale non misura accuratezza, cold-start, capacità a rate imposto o dimensionamento produttivo.

## Screening a client concorrenti: `run.py`

Protocollo distinto, closed-loop, con corpus golden comune e livelli 1/2/4/8 richieste HTTP concorrenti. Usa immagini già costruite; non scarica né costruisce modelli. Per qualificare un solo motore, aggiungere `--engine horizon` e fornire solo la sua `--image`.

```sh
python3 tests/resources/run.py \
  --gold tests/evaluation/gold.json \
  --cpus 2 --memory 4g --budget-seconds 500 \
  --image rizzo=YOUR_VERIFIED_RIZZO_IMAGE \
  --image horizon=YOUR_VERIFIED_HORIZON_IMAGE \
  --image presidio=YOUR_VERIFIED_PRESIDIO_IMAGE \
  --image bardsai=YOUR_VERIFIED_BARDSAI_IMAGE \
  --output tests/resources/results/concurrency/NUOVA_CAMPAGNA
```

Un solo container alla volta, immagine risolta per ID e avviata senza pull, porta host loopback e cleanup verificato; il container non ha isolamento egress, quindi servono immagini verificate e un ambiente controllato. Il budget monotonic include startup, readiness, traffico, transizioni e cleanup: quello predefinito dipende dal numero di motori, quello esplicito richiede almeno 120 s per motore più 15 s di riserva. Il protocollo include idle e warm-up, verifica limiti cgroup, stato OOM ed esiti HTTP. Per confrontare motori, ogni coppia/livello deve avere ≥30 successi, mix dei casi con distanza TV ≤0,10, zero errori e finestre drenate; il plateau richiede inoltre incremento di throughput ≤10% al raddoppio dei client e p95 crescente. `memory.peak` è cumulativo dal container; RSS, cache file e `memory.current` si sovrappongono e non si sommano. Il plateau osservato è diagnostico, non uno SLA. Le run open-loop storiche sono separate da questo runner.

Il runner rifiuta output già esistenti. Ogni receipt salva metadati, conteggi, durate e campioni di risorse, senza testo analizzato né corpi delle risposte. I nuovi output vanno raggruppati per protocollo/campagna sotto `results/length/` o `results/concurrency/`; i percorsi già pubblicati restano immutati per non spezzare i link.
