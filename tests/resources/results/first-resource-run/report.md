# Container resource experiment

Containerized pipelines, not isolated model consumption. All byte figures are bytes; latency is seconds.
Protocol complete: False; stop: None.
Configuration: `{"budget_seconds": 300.0, "cpus": 2.0, "memory": 4294967296, "protocol": {"drain": 5.0, "engine_cleanup": 2.0, "engine_seconds": 95.0, "idle": 5.0, "readiness": 20.0, "recovery": 5.0, "reserve": 15.0, "socket_timeout": 5.0, "warmup": 10.0, "window": 10.0}}`.

| engine | best observed req/s | p95 s (best window successes incl. drain) | max HTTP clients | capacity finding | RAM peak sampled | cgroup lifetime peak | anon sampled max | file sampled max | CPU cores sampled max | CPU budget % sampled max |
|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|
| rizzo | 3.4 | 2.50288 | 8 | inconclusive_unconfirmed | 1865908224 | null | 1853419520 | 1978368 | 2.59514 | 129.757 |
| horizon | 3.5 | 0.920326 | 8 | inconclusive_unconfirmed | 1715314688 | null | 1705238528 | 319488 | 2.27495 | 113.748 |
| presidio | 124.1 | 0.111211 | 8 | preliminary_plateau_observed | 164065280 | null | 161943552 | 28672 | 1.0157 | 50.785 |

## rizzo

Image: `sha256:c1763d1a191f6a658316d75cf2e56dda0709a4e8a9031d5c888481878e1fd72b`; logical image bytes: 2001021368.
Stop: server_drain_unknown; cleanup verified: True.
Coverage: `{"complete": false, "executed": [["idle", 0], ["warmup", 1], ["load", 1], ["load", 2], ["load", 4], ["load", 8]]}`.
Capacity diagnostic: `{"candidate": 2, "concurrency": null, "confirmation_tv": null, "degradation_observed": true, "pair_tv": 0.06060606060606058, "status": "inconclusive_unconfirmed"}`.

| phase | clients | started | success window / drain | errors / timeouts / cancelled / pending | req/s | p50 / p95 / max s | RAM sampled max | CPU cores sampled max |
|---|---:|---:|---|---|---:|---|---:|---:|
| idle | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0 | null / null / null | 1817686016 | 0.402532 |
| warmup | 1 | 34 | 33 / 1 | 0 / 0 / 0 / 0 | 3.3 | 0.184219 / 0.921661 / 1.10142 | 1862766592 | 2.59514 |
| load | 1 | 32 | 31 / 1 | 0 / 0 / 0 / 0 | 3.1 | 0.180475 / 1.0142 / 1.28774 | 1863667712 | 2.43171 |
| load | 2 | 35 | 33 / 2 | 0 / 0 / 0 / 0 | 3.3 | 0.319152 / 1.61305 / 2.11031 | 1864839168 | 2.13955 |
| load | 4 | 38 | 34 / 4 | 0 / 0 / 0 / 0 | 3.4 | 0.811017 / 2.50288 / 2.8102 | 1865715712 | 2.1044 |
| load | 8 | 23 | 15 / 0 | 0 / 2 / 6 / 0 | 2.99507 | 1.02301 / 3.84469 / 3.84469 | 1836494848 | 2.0773 |

### Disk (overlapping scopes; do not sum)

| timing | path | status | logical bytes | allocated bytes |
|---|---|---|---:|---:|
| static_disk | /app/models | present | 1265194486 | null |
| static_disk | /app/node_modules/.cache | absent | null | null |
| static_disk | /home/analyzer/.cache | absent | null | null |
| static_disk | /home/analyzer/.local/share/uv | absent | null | null |
| static_disk | /home/node/.cache | absent | null | null |
| static_disk | /home/node/.npm | absent | null | null |
| static_disk | /root/.cache | absent | null | null |
| static_disk | /root/.local/share/uv | absent | null | null |
| static_disk | /root/.npm | present | 20768 | null |
| static_disk | /tmp/.cache | absent | null | null |
| post_disk | null | unsafe_or_collector_not_stopped | null | null |
Writable-layer bytes after traffic: null.

## horizon

Image: `sha256:e62e14b41f1aa2861dc97f9e9978d1cbc09901a57f12845224e021310a53966c`; logical image bytes: 1582917760.
Stop: budget_cancelled; cleanup verified: True.
Coverage: `{"complete": false, "executed": [["idle", 0], ["warmup", 1], ["load", 1], ["load", 2], ["load", 4], ["load", 8]]}`.
Capacity diagnostic: `{"candidate": 4, "concurrency": null, "confirmation_tv": null, "degradation_observed": true, "pair_tv": 0.0, "status": "inconclusive_unconfirmed"}`.

| phase | clients | started | success window / drain | errors / timeouts / cancelled / pending | req/s | p50 / p95 / max s | RAM sampled max | CPU cores sampled max |
|---|---:|---:|---|---|---:|---|---:|---:|
| idle | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0 | null / null / null | 1616367616 | 1.79058 |
| warmup | 1 | 32 | 31 / 1 | 0 / 0 / 0 / 0 | 3.1 | 0.18241 / 1.0906 / 1.1866 | 1680510976 | 2.10174 |
| load | 1 | 36 | 35 / 1 | 0 / 0 / 0 / 0 | 3.5 | 0.116503 / 0.920326 / 1.09923 | 1705529344 | 2.27495 |
| load | 2 | 33 | 31 / 2 | 0 / 0 / 0 / 0 | 3.1 | 0.431484 / 1.71713 / 1.78017 | 1711386624 | 2.25206 |
| load | 4 | 35 | 31 / 4 | 0 / 0 / 0 / 0 | 3.1 | 1.30567 / 2.18652 / 2.39897 | 1711517696 | 2.14114 |
| load | 8 | 114 | 25 / 3 | 84 / 0 / 2 / 0 | 2.5 | 1.80052 / 2.99754 / 3.17533 | 1715294208 | 2.05937 |

### Disk (overlapping scopes; do not sum)

| timing | path | status | logical bytes | allocated bytes |
|---|---|---|---:|---:|
| static_disk | /app/models | present | 675715358 | null |
| static_disk | /app/node_modules/.cache | absent | null | null |
| static_disk | /home/analyzer/.cache | absent | null | null |
| static_disk | /home/analyzer/.local/share/uv | absent | null | null |
| static_disk | /home/node/.cache | absent | null | null |
| static_disk | /home/node/.npm | absent | null | null |
| static_disk | /root/.cache | absent | null | null |
| static_disk | /root/.local/share/uv | absent | null | null |
| static_disk | /root/.npm | present | 161555893 | null |
| static_disk | /tmp/.cache | absent | null | null |
| post_disk | null | unsafe_or_collector_not_stopped | null | null |
Writable-layer bytes after traffic: null.

## presidio

Image: `sha256:efa37791b30451405ea909137df6407cac1de52f3437dbcbbc6ae39d7c2f647d`; logical image bytes: 847568369.
Stop: None; cleanup verified: True.
Coverage: `{"complete": true, "executed": [["idle", 0], ["warmup", 1], ["load", 1], ["load", 2], ["load", 4], ["load", 8], ["confirmation", 4], ["recovery", 0]]}`.
Capacity diagnostic: `{"candidate": 4, "concurrency": 4, "confirmation_tv": 0.015137800558885615, "degradation_observed": false, "pair_tv": 0.007585499606776194, "status": "preliminary_plateau_observed"}`.

| phase | clients | started | success window / drain | errors / timeouts / cancelled / pending | req/s | p50 / p95 / max s | RAM sampled max | CPU cores sampled max |
|---|---:|---:|---|---|---:|---|---:|---:|
| idle | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0 | null / null / null | 153337856 | 0.17581 |
| warmup | 1 | 1045 | 1044 / 1 | 0 / 0 / 0 / 0 | 104.4 | 0.00705371 / 0.0224445 / 0.155582 | 163553280 | 0.929781 |
| load | 1 | 1075 | 1074 / 1 | 0 / 0 / 0 / 0 | 107.4 | 0.00694263 / 0.022603 / 0.0811987 | 163622912 | 0.92162 |
| load | 2 | 1234 | 1232 / 2 | 0 / 0 / 0 / 0 | 123.2 | 0.0130973 / 0.0321582 / 0.0462813 | 163651584 | 1.0149 |
| load | 4 | 1226 | 1222 / 4 | 0 / 0 / 0 / 0 | 122.2 | 0.0316139 / 0.0563195 / 0.107053 | 163840000 | 1.01381 |
| load | 8 | 1249 | 1241 / 8 | 0 / 0 / 0 / 0 | 124.1 | 0.0605296 / 0.111211 / 0.134525 | 164065280 | 1.01473 |
| confirmation | 4 | 1248 | 1244 / 4 | 0 / 0 / 0 / 0 | 124.4 | 0.0313985 / 0.0555843 / 0.0669689 | 164012032 | 1.0157 |
| recovery | 0 | 0 | 0 / 0 | 0 / 0 / 0 / 0 | 0 | null / null / null | 164016128 | 0.212287 |

### Disk (overlapping scopes; do not sum)

| timing | path | status | logical bytes | allocated bytes |
|---|---|---|---:|---:|
| static_disk | /app/.venv/lib/python3.11/site-packages/it_core_news_sm | present | 16166743 | null |
| static_disk | /app/models | absent | null | null |
| static_disk | /app/node_modules/.cache | absent | null | null |
| static_disk | /home/analyzer/.cache | absent | null | null |
| static_disk | /home/analyzer/.local/share/uv | absent | null | null |
| static_disk | /home/node/.cache | absent | null | null |
| static_disk | /home/node/.npm | absent | null | null |
| static_disk | /root/.cache | present | 289335346 | null |
| static_disk | /root/.cache/uv/archive-v0/0Up-iUfVfc0XxfKK/it_core_news_sm | present | 16166095 | null |
| static_disk | /root/.local/share/uv | absent | null | null |
| static_disk | /root/.npm | absent | null | null |
| static_disk | /tmp/.cache | absent | null | null |
| post_disk | /app/.venv/lib/python3.11/site-packages/it_core_news_sm | present | null | 16314368 |
| post_disk | /app/models | absent | null | null |
| post_disk | /app/node_modules/.cache | absent | null | null |
| post_disk | /home/analyzer/.cache | absent | null | null |
| post_disk | /home/analyzer/.local/share/uv | absent | null | null |
| post_disk | /home/node/.cache | absent | null | null |
| post_disk | /home/node/.npm | absent | null | null |
| post_disk | /root/.cache | present | null | 306483200 |
| post_disk | /root/.cache/uv/archive-v0/0Up-iUfVfc0XxfKK/it_core_news_sm | present | null | 16306176 |
| post_disk | /root/.local/share/uv | absent | null | null |
| post_disk | /root/.npm | absent | null | null |
| post_disk | /tmp/.cache | absent | null | null |
Writable-layer bytes after traffic: 20387.

## Mix and interpretation

Per-case/source completion mix and total fields/characters/words are in stages.csv. Only in-window compliant successes enter throughput/mix; drain belongs to the submitting stage. Success latency includes drain; window_p95 is used for plateau.
Plateau: >=30 in-window successes in both windows, no errors, <=10% gain on doubled clients and increasing window p95; confirmation within +/-10%, total variation <=0.10 for both comparisons. These are exploratory diagnostics, not statistical proof or an SLA.
Different engines may complete different prefixes even with a common case order. HTTP clients are not simultaneous inference workers; Horizon serializes inference with a bounded queue.
Memory file includes shmem: do not add them. Do not add RSS or file cache to memory.current. Per-process PID/PPid/RSS and missing-field reasons are in samples.csv; RSS is not summed.
memory.peak is since container startup when available; per-phase maxima are sampled at about 1 Hz, not exact peaks. CPU includes collector and other container processes; cores = delta usage_usec / delta cgroup monotonic microseconds, quota% = cores / assigned CPUs * 100.
Static exports can warm VM page cache. Post du runs only after collector shutdown; image/model/cache bytes overlap, shared layers are not exclusive recoverable disk, builder cache is out of scope.
Short, warm, order/host-dependent exploratory run: no production capacity, minimum RAM, no-leak or long-term stability claim. Missing data is null, never invented zero. Errors are observed degradation, not proof of CPU saturation.
Incidents: `[]`.
