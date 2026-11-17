# Fixed-rate open-loop capacity stage

Candidate A; single container; fixed offered rate; sanitized receipt.

Engine: `rizzo`; complete: True; stop: None.
Envelope: 2 CPU and 4,000,000,000 bytes.
Offered rate: 3.42 requests/s; stabilization: 30 s; measurement: 90 s.

| offered | submitted | completed | success | capacity rejected | late | drain rejected | timeout | errors | p50 s | p90 s | p95 s | p99 s | req/s | fields/s |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 308 | 308 | 308 | 308 | 0 | 0 | 0 | 0 | 0 | 0.268001 | 0.956978 | 1.49996 | 1.97834 | 3.4 | 3.42222 |

Requests completed after the submission window are drain completions. This single stage is not yet a sustainable-capacity conclusion.

Accounting complete: True; cleanup verified: True.
