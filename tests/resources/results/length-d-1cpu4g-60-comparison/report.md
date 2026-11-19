# Fascia D — 1000 caratteri ASCII (run isolate)

Un container nuovo per PoC, immagini `multi-poc-current` come nella campagna A/B/C, 1 CPU / 4 GiB, una richiesta HTTP client-side alla volta. Tre casi sintetici da 1000 caratteri ASCII e 50 parole (20 occorrenze per caso), 3 warm-up e 60 POST misurati per motore. Il contratto HTTP ammette al massimo 50 parole per campo; le parole D sono più lunghe di quelle A/B/C e questo cambia anche la tokenizzazione. Readiness e warm-up avvengono nello stesso container misurato. I quattro run sono stati eseguiti in sequenza; i receipt A/B/C e il rerun B rimangono separati.

| PoC | req/s | p50 | p95 | CPU media | RAM campionata | Esito |
|---|---:|---:|---:|---:|---:|---:|
| Rizzo | 1,31 | 717,7 ms | 915,6 ms | 1,00 core | 3004 MiB | 60/60 |
| Horizon | 1,26 | 730,7 ms | 971,0 ms | 1,00 core | 1906 MiB | 60/60 |
| Presidio | 135,13 | 7,3 ms | 8,2 ms | 0,80 core | 409 MiB | 60/60 |
| BardsAI | 3,06 | 290,3 ms | 431,2 ms | 1,00 core | 917 MiB | 60/60 |

Totale: 240/240 HTTP 200 conformi e 12/12 warm-up riusciti, zero errori/timeout/OOM e nessun container residuo; ogni receipt è `complete=true` e `cleanup=true`. CPU in core calcolata sul bracket dei contatori cgroup, RAM come massimo di snapshot e campioni cgroup (non picco assoluto). Presidio ha un solo campione durante il ciclo HTTP. Il throughput include i controlli del client fra le richieste. Questo test seriale e warm non misura accuratezza né capacità a rate prefissato; la fascia D isolata non riproduce lo stato della stessa istanza dopo A→B→C, e il cambio della forma delle parole impedisce una conclusione causale della sola lunghezza.

Receipt:
- `../length-d-1cpu4g-60-rizzo-first/rizzo/results.json`
- `../length-d-1cpu4g-60-horizon-first/horizon/results.json`
- `../length-d-1cpu4g-60-presidio-first/presidio/results.json`
- `../length-d-1cpu4g-60-bardsai-first/bardsai/results.json`
