# Fixed-rate open-loop capacity stage

Candidate A; single container; fixed offered rate; sanitized receipt.

Engine: `horizon`; complete: False; stop: container_state_unavailable.
Envelope: 2 CPU and 4,000,000,000 bytes.
Offered rate: 4.325 requests/s; stabilization: 30 s; measurement: 90 s.

| offered | submitted | completed | success | capacity rejected | late | drain rejected | timeout | errors | p50 s | p90 s | p95 s | p99 s | req/s | fields/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| null | null | null | null | null | null | null | null | null | null | null | null | null | null | null |

Requests completed after the submission window are drain completions. This single stage is not yet a sustainable-capacity conclusion.

Accounting complete: False; cleanup verified: True.
