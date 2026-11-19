# BardsAI v2 — memory and HTTP performance

Local Docker Desktop reference; 2 CPU, 4,000,000,000-byte container cap, no swap headroom.
Each mode uses a fresh container. Twelve deterministic length-quantile cases are cycled. Inputs and response bodies are not persisted.

## Closed loop

| Clients | Success rps | p50 ms | p95 ms | p99 ms | HTTP 503 | Memory MiB | PID 1 RSS MiB | CPU cores |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 8.07 | 50.2 | 700.1 | 733.0 | 0 | 1021.1 | 1079.0 | 0.95 |
| 2 | 8.40 | 88.5 | 909.5 | 1019.3 | 0 | 1025.0 | 1082.9 | 1.00 |
| 4 | 8.73 | 268.2 | 1165.0 | 1181.7 | 0 | 1025.0 | 1082.9 | 0.97 |
| 8 | 8.73 | 1057.9 | 1343.4 | 1366.7 | 0 | 1027.2 | 1084.9 | 0.97 |

## Open loop

| Target rps | Submitted | Success rps | p50 ms | p95 ms | p99 ms | HTTP 503 | Client drops | Memory MiB | PID 1 RSS MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 4.37 | 65 | 4.33 | 121.0 | 684.4 | 708.8 | 0 | 0 | 986.3 | 1044.8 |
| 6.99 | 104 | 6.33 | 651.2 | 1551.4 | 1736.2 | 0 | 0 | 987.2 | 1045.3 |
| 8.73 | 130 | 7.93 | 670.5 | 1192.6 | 1351.8 | 0 | 0 | 987.3 | 1046.1 |
| 10.92 | 163 | 7.93 | 3183.5 | 5091.0 | 5364.1 | 0 | 0 | 987.4 | 1046.1 |

## Limits

Short bounded run: it measures this local host and workload, not sustained production capacity or minimum RAM. Phase memory is `memory.current` sampled every 0.5 s. This Docker Desktop kernel does not expose cgroup `memory.peak`; absolute lifetime peaks are unavailable.
