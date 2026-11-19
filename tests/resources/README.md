# Benchmark risorse dei quattro detector

Risultati pubblicati:

- [ONNX intra-op 1](results/bardsai-v2-closed-open-2026-11-18/report.md): screening closed-loop e open-loop a 2 CPU e 4 GB; plateau closed-loop circa 8,7 risposte/s.
- [ONNX intra-op 2](results/bardsai-v2-intraop2-closed-open-2026-11-18/report.md): stesso workload e limiti; plateau closed-loop circa 15,1 risposte/s. La configurazione applicativa pubblicata resta intra-op 1.

## Screening A/B/C/D per lunghezza (nuovo protocollo)

Il test opt-in `length_benchmark.py` è separato dal vecchio A/B/C di configurazione e dal test 1/2/4/8 richieste contemporanee. Usa tre testi sintetici ASCII deterministici per fascia (A=10, B=50, C=150, D=1000 caratteri, conteggio Python `len` = byte UTF-8), un campo `text` e lo stesso ciclo di 60 richieste HTTP per ciascuno dei quattro PoC. Tre richieste della fascia riscaldano il modello prima della misura. Senza `--band`, l'ordine delle fasce è A→B→C→D; ogni fascia ripete i tre testi nello stesso ordine. Il client è closed-loop con un solo POST in corso, quindi il throughput è `HTTP 200 conformi / durata del ciclo di 60 richieste`, inclusi i controlli del client fra POST; p50/p95 sono sulle sole risposte riuscite. Non è una prova a rate fisso e non misura accuratezza.

```sh
python3 tests/resources/length_benchmark.py \
  --count 60 --output tests/resources/results/NUOVA_RUN_LENGTH_ABCD
```

Il runner rifiuta output esistenti. `--engine presidio` (o uno degli altri tre) seleziona un solo motore per qualificazione isolata. Ogni motore è avviato in un container nuovo con budget nominale di 300 s, 1 CPU, 4 GiB di RAM e swap=RAM; la pulizia d'emergenza può superare il budget e marca la run parziale. Il successivo inizia solo dopo cleanup verificato. Le immagini locali `local/dpia-<engine>:multi-poc-current` devono esistere e includere il modello; il preflight rifiuta container estranei già attivi. Il server è pubblicato solo su porta host dinamica loopback. Nei tre motori ONNX la build corrente imposta intra-op/inter-op 1/1 e `ANALYZER_CONCURRENCY=1` impone una richiesta attiva; Presidio usa spaCy, riceve OMP/BLAS=1 e la serialità è garantita dal solo client di prova, non da un limiter applicativo. La memoria massima indicata è un massimo _campionato_ di `memory.current`, comprensivo del processo collector. Il contatore cgroup `memory.peak`, se disponibile, è cumulativo dalla creazione del container e non è attribuito alla sola fascia. La CPU media è ricavata dal delta cgroup nel bracket degli snapshot prima/dopo la fascia (include l'overhead dell'osservatore), mentre il throughput usa il tempo del ciclo di POST e controlli client. Le fasce Presidio brevi possono non contenere campioni periodici; gli snapshot ai bordi sono disponibili ma la memoria sotto carico non è garantita come picco. Ogni receipt registra image ID, limiti, conteggi, errori, timeout, stato OOM/cleanup; il testo e i corpi delle risposte sono esclusi. Una run breve per configurazione descrive questo host e questo workload, non dimensiona 2–3 repliche in produzione.

Per ripetere una sola fascia in un container nuovo: `python3 tests/resources/length_benchmark.py --engine bardsai --band B --count 60 --output tests/resources/results/NUOVA_RUN_B`. Il receipt indica `selected_bands`; il risultato isolato non ha la stessa storia di cache/ordine di B nella campagna A→B→C.

La fascia D aggiunge **1000 caratteri ASCII**. Il limite del contratto HTTP è 50 parole per campo: i tre testi D hanno esattamente 50 parole di 19 lettere sintetiche, separate da spazi e chiuse da un punto. La diversa composizione delle parole rispetto ad A/B/C è necessaria per restare entro il limite, e introduce un possibile effetto della tokenizzazione; non attribuire tutte le differenze alla sola lunghezza. Per una run D isolata usare `--band D` e un output nuovo. Senza `--band`, il runner ora esegue A→B→C→D.

Risultati pubblicati: [campagna D isolata](results/length-d-1cpu4g-60-comparison/report.md).

## Harness opt-in

Il runner standard-library misura in sequenza immagini già costruite di Rizzo, Horizon, Presidio e BardsAI con lo stesso corpus, budget CPU/RAM e protocollo closed-loop. Raccoglie memoria, CPU, latenza, throughput e errori. Non scarica o costruisce immagini, non modifica il golden e non esegue benchmark durante `tests/run.py resources`. I risultati BardsAI sopra sono storici e non costituiscono un nuovo confronto a quattro.

Prima del run occorrono quattro immagini costruite dai sorgenti correnti, con modelli inclusi e provenienza verificata. Le immagini storiche non equivalgono automaticamente al checkout corrente. Verificare inoltre spazio e integrità dello storage Docker; non eseguire prune di dati altrui per sbloccare il benchmark.

```sh
python3 tests/resources/run.py \
  --gold tests/evaluation/gold.json \
  --cpus 2 --memory 4g --budget-seconds 500 \
  --image rizzo=YOUR_VERIFIED_RIZZO_IMAGE \
  --image horizon=YOUR_VERIFIED_HORIZON_IMAGE \
  --image presidio=YOUR_VERIFIED_PRESIDIO_IMAGE \
  --image bardsai=YOUR_VERIFIED_BARDSAI_IMAGE \
  --output tests/resources/results/YOUR_NEW_RUN_ID
```

Per qualificare una sola immagine senza iniziare il confronto, aggiungere `--engine horizon` e fornire soltanto `--image horizon=...` (equivalente per ogni altro motore). Il budget predefinito si adatta al numero di motori; un budget esplicito inferiore a 120 secondi per motore più 15 secondi di riserva viene rifiutato prima degli effetti Docker. Ogni motore ha fino a 20 secondi per readiness e 70 secondi di finestre previste; resta margine per startup, transizioni, drain e cleanup. La preparazione statica delle immagini precede il timer; i 500 secondi non garantiscono il completamento su ogni host.

Le immagini vengono risolte per ID e avviate con `--pull=never`, pubblicando un solo servizio alla volta su una porta dinamica loopback. Il modello deve essere già incluso nell'immagine. Il protocollo non isola l'egress del container: servono immagini verificate e un ambiente controllato.

## Protocollo

Il budget monotonic include startup, readiness, traffico, transizioni, recovery e cleanup. Il protocollo raccoglie idle, warm-up e livelli closed-loop a 1/2/4/8 client con lo stesso corpus e limiti. Throughput e latenza usano soltanto risposte HTTP 200 conformi; errori, drain e timeout sono contati separatamente. I motori possono completare mix diversi della sequenza durante finestre a tempo: il report classifica per ogni coppia e numero di client la distanza TV del mix, richiedendo finestre drenate senza errori, almeno 30 successi per motore e TV ≤ 0,10. I migliori tassi individuali restano descrittivi, non una graduatoria. Il protocollo completo richiede campioni cgroup validi con i limiti CPU/RAM previsti per ciascun motore e stato Docker finale senza OOM o exit, controllati anche al rerender offline. Un test a client chiusi non misura la capacità a rate imposto: le run open-loop storiche su un ramo separato sono distinte da questo protocollo.

Il plateau richiede almeno 30 successi in-window, nessun errore, incremento di throughput non superiore al 10% al raddoppio dei client e p95 crescente. È una diagnostica esplorativa, non uno SLA.

## Telemetria

- `memory.current` e componenti cgroup;
- `memory.peak` quando esposto dal kernel;
- PID, parent, nome e RSS per processo;
- CPU cgroup, throttling e intervalli di campionamento;
- lifecycle, exit code, OOM e cleanup.

Docker Desktop ARM64 non espone `memory.peak` nell'ambiente usato per i risultati pubblicati. I massimi riportati sono campioni periodici, non picchi assoluti di vita del container.

Le prove pubblicate sono screening brevi locali. Servono misure su infrastruttura rappresentativa e soglie esplicite prima di derivare capacità produttiva.
