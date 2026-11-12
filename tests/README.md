# Test e valutazione

Tutti i comandi partono dalla root del repository. Node.js 24 e npm servono ai PoC JavaScript; Python 3.11–3.12 e `uv` al PoC Presidio. Il runner di valutazione usa soltanto la standard library Python.

## Installazione ed esecuzione

```sh
npm --prefix poc-rizzo ci
npm --prefix poc-horizon ci
uv sync --project poc-presidio --frozen --extra dev
python3 tests/run.py
```

La preparazione installa il modello spaCy previsto dal lockfile. Le suite Rizzo e Horizon non richiedono pesi ONNX; la suite Presidio include uno smoke del motore reale locale. Le fixture condivise sostituiscono l'output nativo prima dell'adapter e usano veri server HTTP.

`tests/run.py` esegue tutte le suite oppure quelle indicate, per esempio:

```sh
python3 tests/run.py rizzo contract
```

| Suite | Percorso | Che cosa verifica |
|---|---|---|
| `layout` | `test_layout.py` | Quattro cartelle operative e suite centralizzate |
| `rizzo` | `rizzo/` | API, modello con sessioni finte, regole e dipendenze native |
| `horizon` | `horizon/` | Build, pipeline, adapter e riconoscitori |
| `presidio` | `presidio/` | API, adapter, routing reale e smoke locale |
| `evaluation` | `evaluation/tests/` | Gold, collector con server finti, matrici, errori e rendering |
| `resources` | `resources/tests/` | Contabilità risorse, lifecycle Docker iniettato e HTTP loopback finto; nessun benchmark automatico |
| `contract` | `contract/` | Stesse fixture HTTP contro i tre handler, con inferenza sostituita |

Controlli statici aggiuntivi, dopo l'installazione:

```sh
npm --prefix poc-horizon run typecheck
uv run --project poc-presidio --extra dev ruff check --config poc-presidio/pyproject.toml poc-presidio/src tests/presidio tests/contract/serve-presidio.py
```

## Inferenza e confronto reali

Gli smoke dei README [Rizzo](../poc-rizzo/README.md) e [Horizon](../poc-horizon/README.md) richiedono il prefetch dei modelli. Le [fixture del contratto](contract/README.md#verifiche-ripetibili) possono essere applicate anche ai container già avviati tramite `--base`.

Il [mini stress test delle risorse](resources/README.md) è un esperimento Docker opt-in, sequenziale e limitato nel tempo. Richiede immagini già costruite con provenienza verificata e una nuova directory risultati; supporta anche un gold esterno. La suite `resources` esegue soltanto test unitari e server HTTP finti, mai inferenza o container reali.

Il [pilot comparativo](evaluation/README.md) invia due POST per caso e motore: detection deny-all e policy prevista. Le misure di qualità provengono da questa esecuzione con i detector reali, separata dai test del collector con server finti.
