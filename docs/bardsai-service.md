# BardsAI PII check PoC

Experimental Node.js service using exactly `bardsai/eu-pii-anonimization-multilang-v2` at revision `07a9a69b0d75c551f5f9450b290f864bfc7dfb51`, `@huggingface/transformers` 4.3.2, ONNX q8 on CPU.

The runtime is offline-only: fetch assets first, then start the built service:

```sh
pnpm --filter poc-bardsai-pii-check build
pnpm --filter poc-bardsai-pii-check prefetch
pnpm --filter poc-bardsai-pii-check start
```

After prefetching the pinned assets, build the offline image from the repository root:

```sh
docker build -f poc-bardsai/Dockerfile -t bardsai-pii-check .
```

`start` loads only local files from `poc-bardsai/models/`; both tokenizer and model loads explicitly carry the pinned revision. The application uses a TypeScript/Node port of BardsAI's official JavaScript `word_re` decoder, not the Transformers token-classification pipeline aggregation.

Decoder source/provenance: [`pii.js` at Space revision `0a197d136b8fd968c1fd3b709572fe531ecdb4e4`](https://huggingface.co/spaces/bardsai/eu-pii-anonymization-demo/blob/0a197d136b8fd968c1fd3b709572fe531ecdb4e4/pii.js). Model and upstream demo declare Apache-2.0. The port preserves dynamic `id2label`, 512-token windows with 510-token bodies and 128 overlap, softmax and B/I pooling, Metaspace/BPE plus byte-fallback offsets, word merge/format checks, and the email override. Tests execute the pinned upstream snapshot and the TypeScript port against identical deterministic tokenizer/logit fixtures and compare their outputs.

The manifest fixes the model revision, sizes, and SHA-256 digests of the tokenizer and ONNX weights. Prefetch verification and the Docker build both enforce those digests. Malformed, truncated, or non-finite model logits fail closed before decoding.

The model mapping is deliberately conservative: `PERSON_NAME`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, and `PAYMENT_CARD` map to the corresponding public categories. Italian fiscal code, VAT, and IBAN remain separate deterministic recognizers. HTTP responses contain only verdict and field/category findings; model spans and text never cross the public boundary.

## Environment configuration

Configuration is validated once at startup. Numeric values must be non-empty decimal integers (surrounding whitespace is ignored); invalid values now fail startup instead of using accidental numeric coercions.

| Variable                        | Default     | Accepted range                        |
| ------------------------------- | ----------- | ------------------------------------- |
| `ANALYZER_PORT`                 | 8000        | 0–65535 (0 permits an ephemeral port) |
| `ANALYZER_BIND_HOST`            | `127.0.0.1` | Non-empty host string                 |
| `ANALYZER_CONCURRENCY`          | 2           | 1–9007199254740991                    |
| `ANALYZER_MAX_PENDING_REQUESTS` | 4           | 0–9007199254740991                    |
| `ANALYZER_MAX_QUEUE_WAIT_MS`    | 500         | 1–2147483647                          |
| `ANALYZER_TOKEN_BUDGET`         | 512         | 1–512                                 |
