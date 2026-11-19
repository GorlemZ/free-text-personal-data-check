# Free-text personal-data check — BardsAI v2

Repository sperimentale per valutare un unico detector di dati personali basato su [`bardsai/eu-pii-anonimization-multilang-v2`](https://huggingface.co/bardsai/eu-pii-anonimization-multilang-v2), fissato alla revisione `07a9a69b0d75c551f5f9450b290f864bfc7dfb51`.

Il servizio usa Node.js, TypeScript, Transformers.js 4.3.2 e ONNX q8 su CPU. Il decoder JavaScript ufficiale BardsAI è portato in TypeScript e mantiene windowing, softmax, pooling BIO, aggregazione e merge. Modello e tokenizer vengono caricati da asset locali verificati tramite SHA-256; l'avvio runtime è offline/local-only.

## Contratto HTTP

- `GET /health/ready`
- `POST /v1/analyze`
- massimo 10 campi e 50 parole per campo
- risposta minimizzata con solo verdetto e categorie
- errori tecnici separati dal verdetto business
- ammissione bounded con coda FIFO e timeout

Esempio:

```json
{
  "fields": [
    {
      "fieldId": "description",
      "text": "testo da analizzare",
      "allowedCategories": []
    }
  ]
}
```

Le categorie pubbliche sono `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD` e `IT_DRIVER_LICENSE`.

## Installazione e verifiche

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm check
python3 tests/run.py
```

Il modello non è versionato nel repository. Il prefetch verifica il manifest e prepara `poc-bardsai/models/`:

```sh
pnpm --filter poc-bardsai-pii-check prefetch:model
pnpm --filter poc-bardsai-pii-check smoke
```

## Valutazione

Golden `category-detection-1`, 142 casi:

| Misura            |        Risultato |
| ----------------- | ---------------: |
| Verdetti corretti | 132/142 — 92,96% |
| Body esatti       | 125/142 — 88,03% |
| TP / FP / FN / TN |  96 / 7 / 3 / 36 |
| Recall            |           96,97% |
| Precisione        |           93,20% |

Il [bundle sanificato](tests/evaluation/results/bardsai-v2-category-detection-2026-11-18/) non contiene testo originale, span o score. Un esito `accepted` resta euristico e non certifica l'assenza di dati personali.

## Risorse

Screening locale Docker Desktop ARM64, 2 CPU e 4 GB:

- configurazione pubblicata ONNX 1/1: plateau closed-loop circa 8,7 risposte/s;
- esperimento ONNX 2/1: plateau closed-loop circa 15,1 risposte/s;
- memoria osservata circa 0,93–1,03 GiB per `memory.current` e circa 1,06 GiB RSS.

Sono prove locali brevi, utili per confronto e dimensionamento iniziale; non costituiscono garanzie di capacità produttiva.

## Struttura

- [`poc-bardsai/`](poc-bardsai/README.md): servizio, decoder, prefetch e Dockerfile.
- [`packages/detector-http/`](packages/detector-http/): infrastruttura HTTP condivisa dal servizio.
- [`tests/bardsai/`](tests/bardsai/): unità, integrazione, decoder differenziale e smoke.
- [`tests/contract/`](tests/contract/README.md): contratto HTTP ripetibile.
- [`tests/evaluation/`](tests/evaluation/README.md): golden e risultati funzionali.
- [`tests/resources/`](tests/resources/README.md): protocollo e risultati di memoria/performance.
- [`REPORT.md`](REPORT.md): sintesi tecnica.

Uso sperimentale locale, senza autenticazione. Esporre soltanto su loopback o dietro controlli di accesso adeguati.
