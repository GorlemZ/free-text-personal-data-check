# Candidate A fixed-rate open-loop results

Date: 17 November 2026.

## Scope and decision rule

Horizon and Rizzo were run as single Candidate A replicas with **2 CPU** and **4,000,000,000 bytes**. Each evaluated stage used fixed-rate arrivals, 30 seconds of stabilization and 90 seconds of measurement in the same container, followed by a separate drain. A tested rate is sustainable only when measurement p90 is below 500 ms, with zero errors, timeouts and client/server rejections, complete accounting, stable queue behaviour and verified cleanup.

The corpus is the versioned non-heldout evaluation corpus. These results describe this workload and do not establish generalization or a production promotion threshold.

## Result

**No tested rate met the sustainable-capacity criterion.** The planned 75%, 100%, 125%, 150% and 200% levels were not run because the protocol stops at the first non-sustainable boundary.

| Engine | Stage | Offered rate | Result | Success / offered | Timeouts | Max in-flight | p90 | p95 | Max latency |
|---|---|---:|---|---:|---:|---:|---:|---:|---:|
| Horizon | nominal 50%, stabilization | 4.325 req/s | stopped fail-closed | 34 / 56 | 22 | 22 | 4.084 s | 4.868 s | 4.898 s |
| Horizon | diagnostic measurement | 1.0 req/s | complete, latency gate failed | 90 / 90 | 0 | 2 | 0.807 s | 0.873 s | 1.481 s |
| Horizon | diagnostic measurement | 0.5 req/s | complete, latency gate failed | 45 / 45 | 0 | 1 | 0.803 s | 0.862 s | 1.772 s |
| Rizzo | nominal 50%, measurement | 3.42 req/s | complete, latency gate failed | 308 / 308 | 0 | 8 | 0.957 s | 1.500 s | 2.213 s |
| Rizzo | diagnostic measurement | 1.0 req/s | complete, latency gate failed | 90 / 90 | 0 | 1 | 0.648 s | 0.805 s | 0.863 s |
| Rizzo | diagnostic measurement | 0.5 req/s | complete, latency gate failed | 45 / 45 | 0 | 1 | 0.599 s | 0.768 s | 0.800 s |

At 0.5 req/s both engines had max in-flight 1 and the maximum observed request latency was below the two-second inter-arrival interval. The p90 failure at that point therefore reflects per-request service-time distribution for the measured cohort rather than queue growth. Lower rates were not used to claim capacity because they would cover fewer corpus cases in the fixed 90-second window.

## Resource evidence

Every measured run verified Docker HostConfig at 2,000,000,000 NanoCPUs, 4,000,000,000 bytes memory and equal memory-swap. The cgroup collector observed `cpu.max=200000 100000` and `memory.max=3999997952`, the expected Docker Desktop page-rounded value.

Maximum sampled `memory.current` was approximately 1.70 GB for Horizon and 2.95 GB for Rizzo. Maximum sampled CPU intervals were close to the two-core quota. `memory.peak` was unavailable in this cgroup environment; the report does not convert the sampled maxima into a minimum-RAM claim or an absence-of-leak claim.

## Preserved attempts

- `open-loop-qualification-horizon-a-001`: initial 1 req/s lifecycle qualification, complete, without stabilization; retained as qualification evidence only.
- `open-loop-horizon-a-50-r1`: partial before traffic because the original 500 ms Docker inspection deadline was too short during model startup. The receipt, healthy final container state and verified cleanup are preserved.
- `open-loop-horizon-a-50-r2`: real 50% attempt; stopped during stabilization after timeouts. Measurement was intentionally not started.
- All other rows in `summary.csv` point to their immutable run directories and sanitized receipts.

All owned containers were removed and read-back found no residual benchmark container after each attempt. Receipts contain case metadata, timing, status codes and resource samples; request text, findings, response bodies and free-form error bodies are excluded.

## Consequences and remaining evidence

The earlier closed-loop synthetic screening rates of 8.65 req/s for Horizon and 6.84 req/s for Rizzo do not transfer to the mixed-corpus open-loop latency criterion. Candidate A remains functionally valid, but this campaign provides no sustainable rate under p90 < 500 ms.

A sustained soak tied to a qualifying rate and burst/recovery confirmation were not run because no rate qualified. Cold-start, long-duration memory stability and leak conclusions remain open. Re-running only higher load levels would contradict the stop gate; changing the latency target or workload requires an explicit protocol decision rather than reinterpretation of these receipts.
