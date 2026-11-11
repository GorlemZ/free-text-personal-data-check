# Node Rizzo PII — functional spike

**In progress.** The first checkpoint contains the pinned model manifest, download integrity checks, and BIO decoding/mapping tests. It does not yet establish a working HTTP service or detector quality.

The target is a Node HTTP service with in-process local detection and no Python dependencies in the final container. Business responses contain only `verdict` and forbidden `fieldId`/`category` pairs. Resource performance and memory are explicitly outside this functional spike.

Model candidate: `rizzoaiacademy/rizzo-pii-0.3B`, community ONNX export `andrearuffini/local-privacy-runtime-pii-detector`. `model-manifest.json` pins the export and its author-published file digests. Export parity is the author's claim until independently checked; tests here currently prove only our decoder and semantic mapping.

```sh
npm ci
npm run prefetch
node --test tests/model.test.mjs
```

Model files and dependencies are ignored by Git. No inference requests are made to remote services; prefetch downloads public artifacts. Runtime compatibility and the first comparative HTTP run are pending. Only synthetic inputs are used in this experiment.
