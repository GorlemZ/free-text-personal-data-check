# Audit del confronto uniforme — 12 novembre 2026

**Esito: PASS.** Review indipendente di agente, non validazione umana.

## Integrità dei risultati

Audit `deleg_1da038a9`, task 1, in sola lettura dopo il run:

- Ricomputate direttamente da casi embedded e `observation.response`, senza importare, copiare o eseguire lo scorer del runner, tutte le 135 matrici detection e 15 matrici policy, con 1.050 valori di rapporto, inclusi 103 null.
- Verificati JSON, tutte le righe CSV, le cinque tabelle Markdown e le 12 percentuali nel README della root.
- Confermati 546/546 successi HTTP, 91 casi, 92 campi, 82 testi distinti, 48 famiglie. Entrambe le prove hanno 91 casi riusciti su tutti e tre i motori.
- Per motore: 815 decisioni detection valutabili; 13 coppie unknown escluse, sei carta d'identità e sette patente. Gold policy: 66 rifiuti e 25 accettazioni.
- Confermati tutti i 50 hash registrati: 42 sorgenti runtime, gold, runner e sei esportazioni, sia sul filesystem sia nell'indice Git. I quattro CSV preservano CRLF.
- Ispezione Docker read-only: i tre ID immagine registrati esistono, piattaforma linux/arm64; nessun container rimasto.
- Risposte conformi allo schema chiuso: niente testo, span, score, etichette native extra o metadati del motore; ordine, unicità, policy per campo e verdetti coerenti.
- Confermati i 53 casi originali invariati. Snapshot storici separati, esclusi dalle nuove metriche.

| Motore | Policy TP / TN / FP / FN | Detection TP / TN / FP / FN |
|---|---:|---:|
| Rizzo | 61 / 22 / 3 / 5 | 111 / 680 / 10 / 14 |
| Horizon | 54 / 24 / 1 / 12 | 106 / 687 / 3 / 19 |
| Presidio | 51 / 20 / 5 / 15 | 104 / 678 / 12 / 21 |

## Migrazione e consegna

Review `deleg_1da038a9`, task 2: PASS. Verificati quattro percorsi operativi, suite centralizzate, contesti Docker isolati, link e comandi documentati. Nessuna dipendenza operativa dai percorsi rimossi o dal worktree fratello. Nessun peso del modello, cache, dipendenza installata, output di build o nota PWF nello staging. Gli import legacy corrispondono a 38 scenari e 28 testi letterali del commit sorgente.

Gli snapshot storici JSON/Markdown coincidono con i precedenti blob Git. I quattro CSV storici differiscono da quei blob soltanto per LF→CRLF: le celle e le osservazioni non cambiano. La conservazione byte-identica riguarda gli artefatti generati del filesystem; il precedente Git li aveva normalizzati.

## Verifiche precedenti al run

- Contratto e servizi: review Rizzo #1 PASS; Presidio #1 PASS; Horizon #2 PASS dopo correzione dell'associazione documentale per output nativi privi di offset.
- Gold e runner: review completa prima delle predizioni, 82 testi e 828 decisioni categoria, nessuna correzione alle annotazioni richiesta.
- Suite: layout 2/2, Rizzo 22/22, Horizon 93/93, Presidio 81/81, harness 26/26; contratto HTTP condiviso 342/342.
- Container reali: 68/68 controlli HTTP per servizio. Rizzo/Horizon senza runtime Python.
- Rendering offline: sei esportazioni byte-identiche; gold e sorgenti runtime invariati durante il run. Nessun tuning post-predizione.

Questi controlli verificano correttezza del confronto e coerenza degli artefatti. Il campione rimane piccolo, correlato e non heldout; non certifica accuratezza in produzione. Performance, memoria, latenza e concorrenza non sono state misurate.
