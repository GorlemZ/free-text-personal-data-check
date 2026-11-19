# Controllo dei dati personali nei campi liberi

Quattro PoC locali espongono il contratto di analisi per campi testuali: [BardsAI](poc-bardsai/README.md), [Horizon](poc-horizon/README.md), [Rizzo](poc-rizzo/README.md) e [Presidio](poc-presidio/README.md). Horizon e Rizzo usano il package condiviso `packages/detector-http`; BardsAI conserva la propria implementazione HTTP. Presidio usa Python. I PoC non garantiscono lassenza di dati personali.

## Risultati storici

La [run del 17 novembre 2026](tests/evaluation/results/category-detection-v3-2026-11-17/report.md) ha confrontato **Horizon, Rizzo e Presidio**: 142 casi e 426 risposte HTTP valide. Non comprende BardsAI e non è una nuova esecuzione. La [valutazione BardsAI separata](tests/evaluation/results/bardsai-v2-category-detection-2026-11-18/report.md) risale al 18 novembre. I risultati non sono una stima held-out della qualità produttiva.

## Utilizzo

Installare Node >=24, pnpm 10.29.3, Python e uv; poi `pnpm install --frozen-lockfile` e `python3 tests/run.py`. Si vedano [test](tests/README.md), [contratto](tests/contract/README.md), [valutazione](tests/evaluation/README.md) e i README dei singoli PoC. I modelli locali richiedono il prefetch prima di avviare inferenza reale. Non usare dati sensibili nelle prove.

Le build Docker da root di BardsAI, Horizon e Rizzo richiedono **BuildKit** e il rispettivo `Dockerfile.dockerignore`: ad esempio `DOCKER_BUILDKIT=1 docker build -f poc-bardsai/Dockerfile .`. Il builder legacy ignora tali file: la `.dockerignore` in root esclude deliberatamente il contesto, quindi una build legacy non può riuscire né inviare l'intero workspace. Presidio mantiene il proprio contesto `poc-presidio/`.
