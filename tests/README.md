# Test e valutazione

Tutti i comandi partono dalla root del repository. Servono Node.js, Corepack, pnpm 10.29.3 e Python 3 per i runner standard-library.

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm test
python3 tests/run.py
```

`tests/run.py` esegue tutte le suite oppure quelle indicate:

```sh
python3 tests/run.py bardsai contract layout
python3 tests/run.py evaluation resources
```

| Suite        | Percorso            | Copertura                                                       |
| ------------ | ------------------- | --------------------------------------------------------------- |
| `layout`     | `test_layout.py`    | struttura del repository e wiring degli script                  |
| `bardsai`    | `bardsai/`          | decoder, mapping, regole, HTTP, Docker e differenziale upstream |
| `contract`   | `contract/`         | contratto HTTP completo sul solo servizio BardsAI               |
| `evaluation` | `evaluation/tests/` | golden, collector, metriche, errori e rendering                 |
| `resources`  | `resources/tests/`  | contabilità, lifecycle Docker e HTTP loopback finto             |

## Gate statici

```sh
pnpm check
```

Il comando esegue typecheck, ESLint e Prettier sull'applicazione BardsAI e sul package HTTP.

## Modello reale

I test ordinari non scaricano pesi. Per eseguire inferenza reale:

```sh
pnpm --filter poc-bardsai-pii-check prefetch:model
pnpm --filter poc-bardsai-pii-check smoke
```

Gli asset finiscono in `poc-bardsai/models/`, sono esclusi da Git e vengono verificati contro `poc-bardsai/model-manifest.json`.

## Contratto, golden e risorse

- [`contract/README.md`](contract/README.md): schema e comandi del contratto HTTP.
- [`evaluation/README.md`](evaluation/README.md): golden da 142 casi e bundle sanificato.
- [`resources/README.md`](resources/README.md): protocollo opt-in e risultati closed/open loop.

I bundle pubblicabili non contengono testo originale, span, score o body grezzi. I test delle risorse usano finti server locali; container e benchmark reali restano opt-in.
