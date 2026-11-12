# Container resource experiment

An opt-in, standard-library Python harness for **containerized pipelines**, not isolated model memory or functional accuracy. It does not build/pull images, tune workers/models, modify gold, or touch functional evaluation results. `tests/run.py resources` runs only unit tests and fake loopback HTTP servers; Docker lifecycle calls in that suite use an injected transport.

## Before a real run

- Use Python 3.11+ and a reachable local Docker daemon with Linux cgroup v2. Verify no competing host inference/build/other known workloads. The harness rejects *any* running Docker container without stopping it; it cannot prove the host is otherwise idle.
- Independently verify each already-built image against the intended source/Dockerfile/model manifest. `--image engine=tag/id` is that operator assertion, **not an automatic source attestation**. Prefer immutable IDs. The harness resolves and records IDs before creating containers, checks native host/daemon/image architecture, records server version, and rejects image-declared volumes (exports omit volume data).
- Ensure adequate host/VM disk headroom. Output disk is checked for 100 MiB free; Docker Desktop VM free space is not inferred from host free space. Static export streams are discarded, never extracted/copied into results. Static inventory may warm the VM page cache.
- Defaults are identical `--cpus 2 --memory 4g --memory-swap 4g`; insufficient daemon resources or mismatching inspect/cgroup limits stop the run, with no silent reduction. No intentional OOM, cache dropping, pruning, or global cleanup.
- Run the fake suites before authorizing real inference:

```sh
python3 tests/run.py resources layout evaluation contract
```

## Explicit real command

Run from the repository root, using a **new** output directory and three source-verified image references:

```sh
python3 tests/resources/run.py \
  --gold tests/evaluation/gold.json \
  --cpus 2 --memory 4g --budget-seconds 300 \
  --image rizzo=YOUR_VERIFIED_RIZZO_IMAGE \
  --image horizon=YOUR_VERIFIED_HORIZON_IMAGE \
  --image presidio=YOUR_VERIFIED_PRESIDIO_IMAGE \
  --output tests/resources/results/YOUR_NEW_RUN_ID
```

`--gold` accepts an external absolute path, including the expanded 151-case corpus. The resource loader reuses evaluation's structural/annotation validator in a private function-global scope with corpus-derived source names (`aliasit` included), without changing the evaluation loader, gold, texts, or allowlists on disk. Each request contains the entire original case (including multiple fields), with empty allowlists. A SHA-256 case-ID ordering is shared by every engine and level. The single sequence is allocated across clients, not restarted per client. Input text, findings, response bodies, Docker stderr and raw service logs are never persisted.

No benchmark is started by the centralized test runner. Exit status is 0 for a complete protocol (capacity may still be inconclusive), 2 for partial/stopped runs or invalid input. Existing output directories are refused. Partial receipts retain cleanup and stop reasons; a failed cleanup is not permission to start another engine. Only matching run-label + name + full-ID containers can be removed, and removal is checked again. An interrupted/failed Docker create is recovered by its unique run name and ownership label, never a broad prune.

## Timing and safety

All three static inventories are completed on **unstarted containers** before the first timed start. Images are reused by resolved ID and `--pull=never`; each service binds a dynamically allocated `127.0.0.1` port. Horizon/Presidio receive only their existing bind-host setting; no model or worker tuning is added.

A monotonic 300-second global budget begins before the first start, including startup, readiness, traffic, transitions, recovery and cleanup. Measurement stops at 285 seconds; the final 15 seconds are reserved. Each engine is bounded by 95 seconds, with 2 seconds reserved for its cleanup. Protocol: readiness <=20 s, idle 5 s, warm-up 10 s at one client, then 10 s each at 1/2/4/8 clients, 10 s confirmation of the first eligible plateau candidate (otherwise level 8), recovery <=5 s. Drain is limited to 5 seconds total per engine. Budget beats coverage: unfinished phases are not extrapolated. Emergency cleanup is bounded; any global overrun is an incident, not hidden elapsed time.

HTTP load and readiness run in terminable child processes. A worker owns its keep-alive HTTP connection and sends only after its preceding response. Socket timeout is at most 5 seconds and **never shortened to a stage boundary**. New sends require enough remaining engine/global time for the full timeout; a new load stage is admitted only if its full window plus socket timeout still fits after child startup. Drain/transition accounting includes child startup and teardown, not just HTTP completion time. At a window boundary, only new submissions stop; in-flight replies drain and remain assigned to their submitting stage. Timeout/transport failure cannot establish server quiescence: that engine is stopped/removed, never followed by another level. Forced budget/guard cancellations are distinct from socket timeouts. SIGINT/SIGTERM initiates owned-resource cleanup; subsequent signals are ignored during cleanup. Killing the agent/OS/daemon is outside that guarantee.

The persistent `docker exec -i` shell collector responds to one host sample command per second, reading cgroup files and `/proc/*/status`. EOF/stop closes the shell; there is no detached infinite collector loop, no Python dependency inside Node images, and no corpus text in shell commands. Its overhead is included in container CPU/RAM. A >=90% memory.max sample, OOM event, >3-second telemetry gap, invalid limits, unavailable/exited container or collector failure stops activity. These sampled guards cannot exclude faster peaks.

## First-run qualification and CPU correction

`results/first-resource-run/audit.md` qualifies the original measurements: the first collector timestamped the start of the whole frame before reading memory and CPU counters. Variable read durations distort short CPU maxima; those historical peaks are not validated estimates of quota usage. Original receipts/exports are preserved, not retroactively corrected. The collector now timestamps immediately before/after `cpu.stat`, uses their midpoint and records acquisition duration/source; this correction has automated regression coverage, but has not yet been exercised in a new real-model run. `/proc/uptime` timestamp granularity and non-atomic counter reads still limit precision; never clamp measurements to the assigned quota.

## Accounting and interpretation

- Throughput: compliant HTTP-200 accepted **or rejected** responses finished inside the actual window / actual window duration. No gold accuracy scoring. Drain successes are separate; requests are never counted twice.
- Success p50/p95/max include drain; `window_p95` uses only the throughput population for plateau comparisons. Error latency and outcome counts are separate. `started = completed + cancelled + pending`; timeouts are among completed client attempts, not proof of cancelled server work.
- Capacity: at least 30 in-window successes per compared level, no errors, <=10% throughput gain at doubled HTTP concurrency, and increasing window p95. Confirmation must be within +/-10% of candidate throughput. Both the adjacent comparison and confirmation require case-ID distribution total-variation distance <=0.10. Otherwise report differing mix, insufficient samples, noise or unconfirmed result. No extra levels/replicates are added. Eight clients are **not** eight inference workers; the current Horizon server serializes inference and limits its queue.
- `memory.current`: cgroup total; `anon`, `file`, `shmem`, `kernel` remain separate. `file` includes shmem; do not add them. Per-process PID/parent/name/RSS allows worker identification; RSS is not summed into cgroup usage. Missing fields are null with reasons. Cgroup `memory.peak` is lifetime peak without resets; phase maxima are **sampled** at ~1 Hz.
- CPU cores = delta `usage_usec` / delta monotonic cgroup time in microseconds. Budget percent = cores / configured CPU count * 100. Throttled duration/count deltas, read durations and sample gaps are retained; counter resets/missing values are not treated as zeros.
- Static model/cache inventory uses exported tar logical file sizes, discovering `it_core_news_sm`, `/app/models`, root/user cache and package-manager paths, plus supported cache environment variables. It does not extract model bytes. Post-traffic `du -sk` reports allocated bytes (KiB converted to bytes), only after collector termination and within remaining time; absent paths differ from unreadable paths. Docker inspect separately records image/rootfs/writable-layer sizes. Static logical and post allocated sizes are **not directly subtractable**. Image, embedded models, caches and shared layers overlap; do not sum them as exclusive reclaimable storage. Builder cache is out of scope.

References used for accounting semantics: Linux kernel `Documentation/admin-guide/cgroup-v2` (CPU and Memory controllers) and Docker CLI `docker inspect --size` documentation (`SizeRootFs`, `SizeRw`). The receipt records the actual Docker release; optional kernel counters remain optional.

## Artifacts and offline audit

`results.json` contains sanitized raw request observations, case metadata/order, samples, effective limits, image IDs, phase timing, inventory, coverage, stop reasons and verified cleanup. `stages.csv`, `samples.csv` and `report.md` are deterministic derivatives. Per-case/source mix and aggregate request field/character/word counts are included; slow/fast pipelines can cover different prefixes of the corpus.

```sh
python3 tests/resources/run.py \
  --rerender tests/resources/results/YOUR_RUN_ID/results.json \
  --output tests/resources/results/YOUR_NEW_AUDIT_ID
```

Rerender needs neither Docker nor the current gold. Receipt timestamp/ID/status validation runs before writing. It checks consistency, not authenticity against coordinated edits. This is a brief warm, host/order-dependent experiment: it cannot prove minimum RAM, absent leaks, production capacity or prolonged stability. Missing measurements and failure are valid **partial** outcomes, never fabricated measurements or a performance PASS.
