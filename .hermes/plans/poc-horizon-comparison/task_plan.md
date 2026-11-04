# Piano implementativo — confronto PoC spaCy e Horizon

## Goal
Riorganizzare il repository in `poc-spacy/` (software attuale preservato) e `poc-horizon/` (servizio Node/Transformers.js con Horizon), verificando API, risultati sintetici e andamento memoria/container su un carico bounded e riproducibile.

## Next Step
PoC locale completato; consegnare risultati e limiti senza push.

## Current Phase
Phase 5 — review finale e consegna completata

## Phases
### Phase 1: Ricognizione
- [x] Verificare checkout/remote puliti, contratto del servizio e artefatti Horizon.
- [x] Separare dimensione immagine da memoria del processo/container.
- **Status:** complete

### Phase 2: Piano e review rapide
- [x] Scrivere piano PWF nel percorso `.hermes/plans/`, appunti in `.hermes/notes/`.
- [x] Due review rapide indipendenti (fattibilità/contratto e misure Docker); incorporate le correzioni materiali qui sotto.
- **Status:** complete

### Phase 3: Due PoC autonomi
- [x] Spostare i file PoC esistenti (e relativi test, lockfile, Dockerfile) in `poc-spacy/`, senza alterarne la logica; root README orientativo.
- [x] Prima del servizio, provare inferenza reale con `@huggingface/transformers@4.3.2`, `q8` e il checkpoint fisso. Verificare etichette plausibili su dati sintetici; se incompatibile, registrare blocker anziché creare un servizio fittizio.
- [x] Creare `poc-horizon/` con modello ONNX q8 caricato una sola volta; fissare manifest: SHA256 pubblico dei due grandi file LFS, revisione e dimensione dei piccoli (calcolo hash piccoli bloccato da approval, non ritentato). Prefetch dei file versionati in preparazione locale, inclusione nell'immagine, avvio e inferenza con `allowRemoteModels=false` e rete disattivata; nessun fallback silenzioso fp32/download in request.
- [x] Contratto wire comune per chiavi, field IDs, limiti, JSON duplicato, `allowedEntityTypes`, dedup/ordinamento findings, readiness, 400/503 e UTF-8 valido; versioni policy distinte, categorie non drop-in documentate. Runner HTTP reale condiviso 6 casi × 2 immagini.
- [x] Tabella delle 29 etichette BIO, niente falsa equivalenza (`TAX_ID` ≠ `IT_FISCAL_CODE`), score/aggregazione espliciti; budget 512 token con 503 fail-closed; smoke di entità in coda riuscito.
- [x] Test Node simulati 7/7, smoke reale ONNX q8 offline, benchmark sintetico; nessun dato reale/segreto.
- **Status:** complete

### Phase 4: Misure riproducibili
- [x] Benchmark sintetici su medesimo corpus, categorie comuni (`commonDetector`/`commonPolicy`) e categorie non supportate separate. I 10 esempi non stimano prestazioni produttive.
- [x] Docker build e smoke offline; dimensione immagine separata da RSS e `memory.current` (include file-cache). Container nuovo per serie, `memory.stat` anon/file e `memory.events`; `memory.peak` non disponibile qui, heap JS non strumentato. Stato OOM/exit nel probe, anche in percorso d'errore se Docker è interrogabile.
- [x] Protocollo: 2 serie indipendenti per immagine finale, warmup + 1.000 input sintetici nuovi ad alta novità, campioni 0/250/500/750/1000 e watchdog; 4 client in burst finale, analisi Horizon seriale. 4 GiB senza swap, nessun OOM e zero errori nelle serie finali. Limiti e anomalie in `.hermes/notes/`; criterio `indicativePlateau` true ma non esclude deriva lenta (spaCy RSS monotono).
- **Status:** complete

### Phase 5: Review finale e consegna
- [x] Due review rapide del piano e review avversariale implementativa; corretti decoding UTF-8, rendicontazione guasti e comparabilità categorie. Test, lint, diff check, confronto corpus e smoke passati.
- [x] Istruzioni e serie di memoria in README e `.hermes/notes/`; nessuna integrazione monorepo e nessun push.
- **Status:** complete

## Decisioni e perimetro
- Priorità alla stabilità della memoria/cache, non al modello piccolo; partire con limite test prudente, non presupporre 256 MiB.
- Un solo processo/worker per contenitore nel primo confronto; misurare la concorrenza *reale* invece di dedurla dal numero di client.
- Solo PoC: evitare edge case non essenziali, ma mantenere limiti payload e nessuna esposizione del testo in risposte/errori/log.
- Prove bounded non certificano assenza di crescita a durata illimitata; riportare serie e picchi campionati, non una rassicurazione assoluta.

## Key Questions
1. Transformers.js 4.3.2 carica correttamente `q8` ONNX per questo modello? Verificare con smoke reale e, se necessario, correggere i file richiesti.
2. Quanto occupa il processo a caldo e come evolve la memoria nel container su testi sempre nuovi? Misurare, non stimare.

## Errors Encountered
| Error | Attempt | Resolution |
|---|---:|---|
| PWF init senza directory di destinazione | 1 | Creato `.hermes/plans/poc-horizon-comparison` e reinvocato init con `cwd` esplicito; appunti in `.hermes/notes/`. |
