# Report sul servizio di controllo dati personali

**PLAN_ID:** `report-servizio-detector`

## Goal
Produrre un documento italiano conciso: introduzione (origine Presidio, flusso, golden e NLP), correttezza/sensibilità (semantica, metodo, FP/FN e risultati), capacità tecniche del container (modelli, alleggerimento, concorrenza, memoria e misure). Scrivere frasi affermative e descrittive. Non modificare il prodotto né pubblicare senza richiesta.

## Current Phase
Il report autonomo `REPORT.md` è stato creato con il confronto funzionale totale del 17 novembre e gli screening tecnici A/B/C. La tabella funzionale usa lo stesso gold esteso per Rizzo, Horizon e Presidio: 151 scenari e 906/906 richieste riuscite. La sezione tecnica distingue gli screening closed-loop dalla capacità produttiva e lascia esplicitamente pending curve open-loop, cold start ripetuti e run prolungati. Il testo presenta risultati descrittivi e non sceglie una topologia.

### Phase 1: Intervista e perimetro
**Status:** complete
### Phase 2: Ricognizione delle evidenze e stesura
**Status:** complete
### Phase 3: Revisione di accuratezza, stile e consegna
**Status:** complete

## Confini di evidenza
Il confronto funzionale corrente del 17 novembre contiene 151 scenari, 152 campi e 906 POST su tre motori, con bundle e contesto in `tests/evaluation/results/main-2026-11-17/`. Gli screening A/B/C sono prove brevi closed-loop entro 2 CPU e 4 GB e non certificano throughput sostenibile. Candidate C è esclusa per Rizzo a causa di OOM; Horizon raggiunge p90 469,6 ms nel singolo screening ma arriva a 3.993.735.168 byte al cold load. Le curve open-loop restano da eseguire.
