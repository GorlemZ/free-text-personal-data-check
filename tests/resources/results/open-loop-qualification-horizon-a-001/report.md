# Fixed-rate open-loop capacity stage

Candidate A; single container; fixed offered rate; sanitized receipt.

Engine: `horizon`; complete: True; stop: None.
Envelope: 2 CPU and 4,000,000,000 bytes.
Offered rate: 1 requests/s; measurement: 10 s.

| offered | submitted | completed | success | capacity rejected | late | drain rejected | timeout | errors | p50 s | p90 s | p95 s | p99 s | req/s | fields/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 10 | 10 | 10 | 10 | 0 | 0 | 0 | 0 | 0 | 0.188698 | 0.674127 | 0.872631 | 0.872631 | 1 | 1 |

Requests completed after the submission window are drain completions. This single stage is not yet a sustainable-capacity conclusion.

Accounting complete: True; cleanup verified: True.
