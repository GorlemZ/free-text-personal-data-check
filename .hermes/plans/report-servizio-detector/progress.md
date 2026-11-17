# Progress — report servizio detector

- Ricognizione iniziale: repository `main` pulito al commit ce5d395; letti README, contratto, piano funzionale, pilot e report Candidate A/B/C. Nessun benchmark eseguito in questa sessione.
- Intervista conclusa dopo 7 domande: fu richiesto un run esteso a tre motori e un documento autonomo per stakeholder tecnici/funzionali, con verdetto e sintesi per categoria. Questa voce registra lo stato storico precedente all'esecuzione; il run Presidio e il confronto 906/906 sono stati completati successivamente.
- Ricognizione aggiuntiva: il codice carica Horizon ONNX q8 e Rizzo ONNX fp32; il report mantiene esplicita questa differenza.
- 2026-11-17 — Creato `REPORT.md`: flusso e contratto, metodo golden esteso, verdetti e detection per categoria sui tre motori, configurazioni A/B/C, coda/concorrenza, evidenze e lavoro residuo. I dati funzionali provengono dal run 906/906; i dati tecnici restano screening closed-loop con caveat e link agli artefatti.
- 2026-11-17 — Review indipendente finale passata dopo correzione dell'unità del margine memoria, aggiunta dei confini di sicurezza/privacy, qualificazione delle differenze di parsing e marcatura dello stato PWF storico. Validazione golden, 33/33 test, verifica fonti 60/60 e `git diff --check` passati.
