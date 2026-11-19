# Test e valutazione

Dalla root: `pnpm install --frozen-lockfile`, `pnpm build`, `python3 tests/run.py`. Node >=24 e pnpm 10.29.3 servono ai servizi TypeScript; `uv` e Python servono a Presidio. Selezionare singole suite con `python3 tests/run.py bardsai horizon rizzo presidio evaluation resources contract`. `pnpm check` esegue typecheck, lint e formattazione.

La regressione del contesto Docker si esegue separatamente con `python3 -m unittest discover -s tests -p test_docker_context.py -v`: richiede la CLI Docker, ma non il daemon; invia solo fixture sintetiche a uno stub loopback. Verifica il packing delle regole Dockerfile-specifiche selezionate come fa BuildKit e il fail-closed legacy, non costruisce immagini.

Il contratto esercita quattro handler con inferenza simulata. Le suite evaluation e resources usano server finti; non eseguono nuovi benchmark né inferenza golden. `pnpm --filter poc-bardsai-pii-check smoke` usa invece il modello reale disponibile localmente.

Il [report storico](evaluation/results/category-detection-v3-2026-11-17/report.md) copre soltanto Horizon, Rizzo e Presidio: 142 casi, 426 risposte. La valutazione BardsAI è un [run distinto](evaluation/results/bardsai-v2-category-detection-2026-11-18/report.md).
