# PoC BardsAI

Dal repository root: `pnpm install --frozen-lockfile`, `pnpm --filter poc-bardsai-pii-check build`, quindi `pnpm --filter poc-bardsai-pii-check prefetch` per predisporre gli asset locali e `pnpm --filter poc-bardsai-pii-check smoke` per la verifica reale. `pnpm --filter poc-bardsai-pii-check start` avvia il servizio. I modelli sono in `poc-bardsai/models/` e non sono tracciati.

`docker build -f poc-bardsai/Dockerfile -t bardsai-pii-check .` usa la root del repository come contesto e richiede gli asset già disponibili. Per laccesso dallhost pubblicare soltanto su loopback e impostare il bind del container esplicitamente: `docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0 -p 127.0.0.1:8000:8000 bardsai-pii-check`. Il bind predefinito del servizio è `127.0.0.1`.

Il servizio non certifica lassenza di dati personali. Vedi [test](../tests/README.md) e [valutazione](../tests/evaluation/README.md).

La [documentazione del servizio](docs/bardsai-service.md) descrive modello, decoder e configurazione.
