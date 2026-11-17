# Fixed-rate open-loop capacity stage

Candidate A; single container; fixed offered rate; sanitized receipt.

Engine: `rizzo`; complete: True; stop: None.
Envelope: 2 CPU and 4,000,000,000 bytes.
Offered rate: 0.5 requests/s; stabilization: 30 s; measurement: 90 s.

| offered | submitted | completed | success | capacity rejected | late | drain rejected | timeout | errors | p50 s | p90 s | p95 s | p99 s | req/s | fields/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 45 | 45 | 45 | 45 | 0 | 0 | 0 | 0 | 0 | 0.134966 | 0.599333 | 0.768416 | 0.79973 | 0.5 | 0.5 |

Requests completed after the submission window are drain completions. This single stage is not yet a sustainable-capacity conclusion.

Accounting complete: True; cleanup verified: True.
