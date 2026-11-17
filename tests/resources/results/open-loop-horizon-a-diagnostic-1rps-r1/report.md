# Fixed-rate open-loop capacity stage

Candidate A; single container; fixed offered rate; sanitized receipt.

Engine: `horizon`; complete: True; stop: None.
Envelope: 2 CPU and 4,000,000,000 bytes.
Offered rate: 1 requests/s; stabilization: 30 s; measurement: 90 s.

| offered | submitted | completed | success | capacity rejected | late | drain rejected | timeout | errors | p50 s | p90 s | p95 s | p99 s | req/s | fields/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90 | 90 | 90 | 90 | 0 | 0 | 0 | 0 | 0 | 0.144544 | 0.806666 | 0.872909 | 1.48054 | 1 | 1 |

Requests completed after the submission window are drain completions. This single stage is not yet a sustainable-capacity conclusion.

Accounting complete: True; cleanup verified: True.
