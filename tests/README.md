# Test e valutazione

Tutti i comandi partono dalla root del repository. Node.js 24, Corepack e pnpm 10.29.3 servono ai PoC TypeScript; Python 3.11–3.12 e `uv` al PoC Presidio. Il runner di valutazione usa soltanto la standard library Python.

## Installazione ed esecuzione

```sh
corepack enable
pnpm install --frozen-lockfile
uv sync --project poc-presidio --frozen --extra dev
python3 tests/run.py
```

La preparazione installa il modello spaCy previsto dal lockfile. La suite Horizon non richiede pesi ONNX; la suite Presidio include uno smoke del motore reale locale. Le fixture condivise sostituiscono l'output nativo prima dell'adapter e usano veri server HTTP.

`tests/run.py` esegue tutte le suite oppure quelle indicate, per esempio:

```sh
python3 tests/run.py horizon contract
```

| Suite        | Percorso            | Che cosa verifica                                                                                  |
| ------------ | ------------------- | -------------------------------------------------------------------------------------------------- |
| `layout`     | `test_layout.py`    | Cartelle operative e suite centralizzate                                                           |
| `horizon`    | `horizon/`          | Build, pipeline, adapter e riconoscitori                                                           |
| `presidio`   | `presidio/`         | API, adapter, routing reale e smoke locale                                                         |
| `evaluation` | `evaluation/tests/` | Gold, collector con server finti, matrici, errori e rendering                                      |
| `resources`  | `resources/tests/`  | Contabilità risorse, lifecycle Docker iniettato e HTTP loopback finto; nessun benchmark automatico |
| `contract`   | `contract/`         | Stesse fixture HTTP contro i due handler, con inferenza sostituita                                 |

Controlli statici aggiuntivi, dopo l'installazione:

```sh
pnpm typecheck
uv run --project poc-presidio --extra dev ruff check --config poc-presidio/pyproject.toml poc-presidio/src tests/presidio tests/contract/serve-presidio.py
```

## Suite Node senza pesi

Per lavorare soltanto su Horizon, senza invocare il runner Python:

```sh
pnpm test
pnpm check
```

## Inferenza e confronto reali

Lo smoke del README [Horizon](../poc-horizon/README.md) richiede il prefetch del modello. Le [fixture del contratto](contract/README.md#verifiche-ripetibili) possono essere applicate anche ai container già avviati tramite `--base`.

Il [mini stress test delle risorse](resources/README.md) è un esperimento Docker opt-in, sequenziale e limitato nel tempo. Richiede immagini già costruite con provenienza verificata e una nuova directory risultati; supporta anche un gold esterno. La suite `resources` esegue soltanto test unitari e server HTTP finti, mai inferenza o container reali.

Il [confronto golden](evaluation/README.md) invia una sola POST deny-all per caso e motore. Le misure pubblicate provengono dalle 426 osservazioni del bundle corrente; i test del runner usano server HTTP finti e non eseguono le suite locali dei PoC.
