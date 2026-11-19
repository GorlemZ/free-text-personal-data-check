# Screening A/B/C — quattro PoC

Input ASCII di 10/50/150 caratteri; un container nuovo per PoC, fasce A→B→C nello stesso container. 1 CPU, 4 GiB, una richiesta HTTP client alla volta, tre warm-up e 60 POST misurati per fascia. Il modello è già caricato durante la misura.

| Fascia | PoC | HTTP 200 | req/s | p50 ms | p95 ms | CPU core | RAM MiB* |
|---|---|---:|---:|---:|---:|---:|---:|
| A | Rizzo | 60/60 | 36.97 | 23.1 | 27.2 | 1.00 | 1708 |
| A | Horizon | 60/60 | 36.65 | 23.1 | 34.5 | 0.99 | 1885 |
| A | Presidio | 60/60 | 314.50 | 2.9 | 4.5 | 0.58 | 407 |
| A | BardsAI | 60/60 | 83.14 | 9.9 | 13.4 | 1.01 | 1195 |
| B | Rizzo | 60/60 | 18.23 | 43.6 | 132.4 | 0.99 | 1884 |
| B | Horizon | 60/60 | 19.23 | 43.8 | 115.0 | 0.99 | 1950 |
| B | Presidio | 60/60 | 271.52 | 3.4 | 5.3 | 0.69 | 409 |
| B | BardsAI | 60/60 | 41.33 | 16.8 | 75.2 | 1.04 | 1256 |
| C | Rizzo | 60/60 | 9.51 | 94.0 | 148.7 | 1.00 | 2041 |
| C | Horizon | 60/60 | 9.68 | 94.3 | 142.3 | 1.00 | 2052 |
| C | Presidio | 60/60 | 185.39 | 5.1 | 6.9 | 0.72 | 412 |
| C | BardsAI | 60/60 | 23.12 | 35.8 | 75.8 | 0.97 | 1332 |

**Esito:** 720/720 POST e 36/36 warm-up conformi; zero errori HTTP, timeout o OOM; cleanup verificato per tutti e quattro i container. *RAM = massimo campionato di `memory.current`, non picco assoluto; Presidio A/C e BardsAI A hanno solo snapshot ai bordi della fascia. CPU media sul bracket cgroup con osservatore; throughput closed-loop comprensivo dei controlli client. Una sola esecuzione con ordine A→B→C: non prova accuratezza o capacità produttiva.*

**Receipt:** [Rizzo](rizzo/results.json) · [Horizon](horizon/results.json) · [Presidio](presidio/results.json) · [BardsAI](bardsai/results.json) · [riepilogo](summary.json). Le immagini usate sono identificate dagli ID nei receipt; l'ID da solo non attesta la revisione sorgente della build.
