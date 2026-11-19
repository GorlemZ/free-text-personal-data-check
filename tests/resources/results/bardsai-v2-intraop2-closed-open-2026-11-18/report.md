# BardsAI v2 — memory and HTTP performance (`intraOpNumThreads: 2`)

Local Docker Desktop reference; 2 CPU, 4,000,000,000-byte container cap, no swap headroom. ONNX threads: intra-op 2, inter-op 1.
Each mode uses a fresh container. Twelve deterministic length-quantile cases are cycled. Inputs and response bodies are not persisted.

## Closed loop

| Clients | Success rps | p50 ms | p95 ms | p99 ms | HTTP 503 | Memory MiB | PID 1 RSS MiB | CPU cores |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 13.47 | 31.9 | 371.4 | 396.7 | 0 | 992.6 | 1053.0 | 1.87 |
| 2 | 14.93 | 66.5 | 482.1 | 507.3 | 0 | 992.8 | 1053.0 | 1.94 |
| 4 | 15.13 | 183.6 | 629.0 | 653.4 | 0 | 996.5 | 1056.6 | 1.92 |
| 8 | 15.07 | 631.9 | 854.3 | 1373.4 | 0 | 996.7 | 1056.6 | 1.92 |

## Open loop

| Target rps | Submitted | Success rps | p50 ms | p95 ms | p99 ms | HTTP 503 | Client drops | Memory MiB | PID 1 RSS MiB |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 7.57 | 113 | 7.53 | 54.9 | 369.8 | 412.2 | 0 | 0 | 997.4 | 1057.4 |
| 12.11 | 181 | 11.93 | 115.0 | 417.2 | 468.7 | 0 | 0 | 997.6 | 1057.4 |
| 15.13 | 226 | 14.47 | 389.8 | 669.6 | 761.2 | 0 | 0 | 997.9 | 1057.9 |
| 18.92 | 280 | 14.67 | 2176.8 | 3910.1 | 4176.9 | 0 | 3 | 998.2 | 1058.5 |

## Limits

Short bounded run: it measures this local host and workload, not sustained production capacity or minimum RAM. Phase memory is `memory.current` sampled every 0.5 s. This Docker Desktop kernel does not expose cgroup `memory.peak`; absolute lifetime peaks are unavailable. The 18.92 req/s stage exhausted the 64-request client cap three times and is inconclusive as a pure service-overload measurement.
