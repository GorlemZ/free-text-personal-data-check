# Production Detector Capacity Configurations Plan

> **For Hermes:** Implement against the confirmed production envelope: maximum 2 CPU cores and 4 GB RAM per replica.

**Goal:** Compare three deployable scheduling topologies for Horizon and Rizzo and estimate sustainable production throughput, latency under queueing, overload behavior and memory cost per replica.

**Architecture:** Hold the total CPU budget constant across candidates and vary where parallelism lives: inside one ONNX inference, across concurrent calls on one model session, or across two Node processes/model sessions. Use an explicitly bounded FIFO admission queue and drive the service with open-loop offered load until it reaches the agreed latency/error boundary.

**Tech stack:** Node.js 24, Transformers.js 4.3.2, onnxruntime-node, Docker/cgroup v2, TypeScript, fixed-rate HTTP load generator.

---

## 1. Confirmed production envelope

- Maximum **2 CPU cores per replica**.
- Maximum **4 GB RAM per replica**. Use the conservative decimal cap `4_000_000_000` bytes in Docker/cgroup tests and record the page-rounded `memory.max`; do not silently reinterpret it as 4 GiB.
- Existing latency objective: p90 end-to-end below 500 ms after warm-up. Report the full p50/p90/p95/p99 curve even if no candidate meets it.
- Sustainable-load levels must have zero runtime errors/timeouts and no admission rejection; rejection is measured separately in the overload/burst test.
- The current Docker VM exposes 5 CPUs and 8,232,828,928 bytes RAM, sufficient to run one 2-core/4-GB candidate at a time without claiming hardware equivalence to production.

## 2. Invariants

Keep fixed across all candidates:

- exact model, tokenizer, revision, precision, thresholds and inference output;
- HTTP contract, fail-closed behavior and model-before-listen;
- same total CPU quota per replica;
- same request corpus and offered-load schedule;
- maximum 10 fields and current token budgets;
- one request occupies its active permit until the underlying inference actually ends, even after client timeout;
- bounded body parsing, bounded active inference and bounded pending queue as separate limits;
- no unbounded pending queue.

Record requests/s and fields/s. Multi-field payloads make requests/s alone misleading.

## 3. Three production candidates

All candidates use the same maximum two-core replica budget.

### Candidate A — One process, wide single inference

```text
Node processes             1
Model sessions             1
ORT intra-op threads       2
ORT inter-op threads       1
Active requests            1
Pending requests           4
Total model copies         1
```

Purpose: maximize each inference's speed and keep execution strictly serial. This is the lowest-risk topology and the memory baseline. The queue absorbs only a short burst; it does not add throughput.

### Candidate B — One process, shared-session asynchronous concurrency

```text
Node processes             1
Model sessions             1
ORT intra-op threads       1
ORT inter-op threads       1
Active requests            2
Pending requests           4
Total model copies         1
```

Purpose: overlap two independent requests on the same ONNX session while staying within the same nominal two-thread CPU budget. This tests whether shared-session concurrency increases completed requests/s enough to justify higher per-request latency and native working memory.

Promotion requires a real-model concurrency parity gate: different simultaneous inputs, 1/5/10-field requests, one failing request beside one valid request, deterministic public responses and no cross-request contamination.

Status 2026-11-16: parity gate passed for Horizon and Rizzo. The preliminary two-client screening reached Horizon 5.12 req/s at p90 752.6 ms and Rizzo 5.02 req/s at p90 789.7 ms, so both exceeded the provisional 500 ms p90 target. Candidate B is not promoted on this evidence; open-loop curves remain required for the final comparison.

### Candidate C — Two processes, one model session each

```text
Node processes             2
Model sessions             2
ORT intra-op threads       1 per process
ORT inter-op threads       1 per process
Active requests            1 per process
Pending requests           2 per process
Total active               2
Total pending              4
Total model copies         2
```

Purpose: isolate inference state and event loops while using the same nominal two-thread CPU budget. A local reverse proxy or production-equivalent pod routing layer distributes requests. This is likely to provide the cleanest parallelism and the highest memory cost because model/session state is duplicated. Candidate C is excluded for an engine if two loaded sessions cannot remain below the 4,000,000,000-byte replica cap; the cap is never raised to make it pass.

If production permits only one process per container, run Candidate C as two containers behind the same load balancer and account memory at pod or replica-set scope.

## 4. Queue policy under test

Extend admission from the current immediate-reject policy to explicit parameters:

```text
activeLimit
maxPendingRequests
maxQueueWaitMs
```

Required semantics:

1. Validate the entire body before admission.
2. If active capacity exists, enter immediately.
3. Otherwise enqueue only while `pending < maxPendingRequests`.
4. Reject excess with the existing public 503 response.
5. Expire queued requests after `maxQueueWaitMs`; never start expired work.
6. Client disconnect removes a request only while still queued. Once inference starts, its active permit remains occupied until native work finishes.
7. During shutdown, stop admission, reject pending work and bound the drain of active work.
8. Expose queue depth and active count only to benchmark/internal telemetry, never in the public response.

Candidate A screening caveat: in the single-process topology, a timer cannot produce a hard wall-clock response deadline while CPU-bound inference delays the Node.js event loop. Treat `maxQueueWaitMs` as a best-effort admission expiry that prevents stale inference work; measure and report the actual HTTP response delay separately.

The first comparison keeps total pending capacity at four across all candidates so queue size does not bias results.

## 5. Workload profiles

Use a fixed synthetic corpus with no real personal data:

- **S1:** one short field;
- **S2:** one medium field;
- **S3:** one near-token-budget field;
- **M5:** five mixed-length fields;
- **M10:** ten mixed-length fields;
- **Mix:** declared production-like proportions of S1/S2/S3/M5/M10.

Run both homogeneous profiles and Mix. A topology can be good for one-field requests and poor for ten-field requests because fields are currently inferred sequentially.

Restart the exact corpus sequence for every candidate and record per-profile counts. Report fields/s in addition to requests/s.

## 6. Load method: measure capacity, not just completion speed

Use an **open-loop fixed-rate generator** so queueing and rejection are observable. A closed-loop client alone hides saturation by reducing offered load when responses slow down.

### 6.1 Service-time calibration

For each engine and candidate:

1. start a fresh container or pod;
2. wait for readiness and send five warm-up requests;
3. run 30 serial requests per workload profile;
4. calculate initial service rate and p50/p95.

Calibration selects offered-load steps; it is not the throughput result.

### 6.2 Offered-load staircase

For Mix, submit at fixed arrival rates based on the calibrated rate:

```text
50%, 75%, 100%, 125%, 150%, 200%
```

Each level:

- 30-second stabilization;
- 90-second measurement window;
- stop new submissions at the boundary;
- drain in-flight work under a separate deadline;
- restore active and pending counts to zero before the next level.

If a level violates the agreed p95/error boundary, run one midpoint between the last good and first bad levels. Do not continue higher merely to generate rejections.

### 6.3 Burst test

After sustainable capacity is identified, send a short burst equal to:

```text
active capacity + pending capacity + 50%
```

Measure queue wait, completion latency, immediate rejection, queue timeout and recovery. This determines whether the queue is operationally useful; it is not included in sustainable throughput.

## 7. Metrics

For every level and workload profile:

- offered, admitted, queued, started, completed and rejected requests;
- queue-timeout, client-timeout, runtime-error and budget-cancel counts;
- requests/s and fields/s;
- service time separately from queue wait;
- end-to-end p50/p90/p95/p99;
- queue-depth and active-count time series;
- cgroup `memory.current`, `memory.peak`, `memory.events`, anon/file split;
- process RSS/high-water mark and thread count for every worker process;
- CPU quota and `cpu.stat` utilization/throttling;
- event-loop responsiveness and health latency;
- startup time and model copies loaded;
- exit code and Docker `OOMKilled` state.

For Candidate C, report per-process RSS and pod/container aggregate memory. Do not add RSS to cgroup memory.

## 8. Capacity definition

A candidate's sustainable capacity is the highest offered-load level where all are true:

- p90 end-to-end latency remains below 500 ms after warm-up;
- runtime errors and timeouts are zero;
- expected admission rejections stay within the agreed overload policy;
- queue depth does not grow throughout the measurement window;
- CPU and memory remain within the production quota;
- the confirmation window reproduces comparable throughput and latency.

If no candidate meets p90 below 500 ms, report the full throughput/latency/rejection curve and the highest stable tested level, but do not label it compliant production capacity.

## 9. Functional and isolation gates

Before real load:

1. existing Horizon, Rizzo and contract suites pass;
2. exact responses match each engine's single-request baseline;
3. Candidate B passes shared-session simultaneous-input isolation tests;
4. Candidate C passes load-balancer distribution, worker failure and readiness tests;
5. queue tests cover full queue, queue timeout, disconnect before start, disconnect during inference, active failure, shutdown and permit recovery;
6. the real-model compatibility probe confirms pinned Transformers.js forwards `session_options` to ONNX Runtime.

Passing fake-detector tests validates queue accounting, not real capacity.

## 10. Repetition and run order

### Screening

Run each candidate once per engine, rotating order:

- Horizon: A → B → C;
- Rizzo: C → B → A.

### Confirmation

Select the best two eligible candidates per engine and repeat the saturation boundary twice, alternating order. Select winners independently for Horizon and Rizzo.

If the ranking changes between confirmation runs, report it as inconclusive. Do not average unstable runs into a winner.

## 11. Files likely to change

- `poc-horizon/src/config/config.ts`
- `poc-horizon/src/adapters/transformersAdapter.ts`
- `poc-rizzo/src/config/config.ts`
- `poc-rizzo/src/config/modelConfig.ts`
- `poc-rizzo/src/adapters/transformersAdapter.ts`
- `poc-horizon/src/utilities/admission.ts`
- `poc-rizzo/src/utilities/admission.ts`
- shared admission package only if both implementations can be unified without widening scope;
- `tests/horizon/admission.test.mjs`
- `tests/rizzo/admission.test.mjs`
- `tests/memory/run.mjs`
- `tests/memory/load.mjs`
- `tests/memory/collect.mjs`
- `tests/memory/corpus.json`
- `tests/memory/run.test.mjs`
- `tests/memory/README.md`
- optional benchmark-only proxy or process supervisor for Candidate C.

Do not add a public metrics endpoint solely for this benchmark.

## 12. Verification commands after implementation

```sh
rtk pnpm check
rtk pnpm test
rtk python3 tests/contract/run.py
rtk node --test tests/memory/run.test.mjs
rtk node tests/memory/run.mjs --engine horizon --candidates A,B,C
rtk node tests/memory/run.mjs --engine rizzo --candidates A,B,C
```

The harness must require an explicit real-Docker command; normal unit tests must not start models or containers.

## 13. Deliverable

For each engine, produce:

1. throughput/latency/rejection curve for A, B and C;
2. sustainable requests/s and fields/s under the agreed SLO;
3. memory and CPU cost at that point;
4. queue behavior during burst and overload;
5. estimated replicas required for a declared target traffic rate;
6. recommendation among one wide serial process, one shared session with two concurrent requests, two isolated processes/sessions, or inconclusive.

The final recommendation is per engine and valid only for the tested two-core, 4,000,000,000-byte replica envelope.
