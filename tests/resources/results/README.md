# Risultati benchmark risorse

Indice dei bundle **pubblicati**. I receipt sono immutabili: un nuovo tentativo usa sempre una directory nuova. I percorsi storici restano invariati per preservare i link; per le prossime campagne usare `length/<campagna>/` oppure `concurrency/<campagna>/` sotto questa directory.

## Lunghezza input — 1 CPU / 4 GiB, POST seriali

| Campagna | Confronto / dati |
|---|---|
| D — 1000 caratteri, run isolate dei quattro motori | [Report](length-d-1cpu4g-60-comparison/report.md) · [Rizzo](length-d-1cpu4g-60-rizzo-first/rizzo/results.json) · [Horizon](length-d-1cpu4g-60-horizon-first/horizon/results.json) · [Presidio](length-d-1cpu4g-60-presidio-first/presidio/results.json) · [BardsAI](length-d-1cpu4g-60-bardsai-first/bardsai/results.json) |

D usa parole più lunghe per rispettare il limite di 50 parole e modifica anche la tokenizzazione. Ogni motore parte in un container nuovo.

## Screening storico BardsAI — 2 CPU

- [ONNX intra-op 1](bardsai-v2-closed-open-2026-11-18/report.md): closed-loop e open-loop.
- [ONNX intra-op 2](bardsai-v2-intraop2-closed-open-2026-11-18/report.md): configurazione alternativa, non adottata.

[Protocollo e comandi](../README.md)
