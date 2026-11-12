# Pilot unico: Rizzo, Horizon, Presidio

`gold.json` → **due POST reali per caso e motore** a `/v1/analyze` →
`results.json`, `detection.csv`, `verdict.csv`, `coverage.csv`, `observations.csv`, `report.md`.
Python standard library soltanto: nessun import di detector, download, preparazione parquet,
avvio container o inferenza durante preflight/test. `gold.json` è l'unico gold statico
autorevole; non esiste un comando che lo rigeneri o sovrascriva.

## Run reale completato

Il run `uniform-http` del 12 novembre 2026 ha completato **546/546 POST** sui tre
container reali, con zero errori tecnici/contrattuali. Gold e sorgenti runtime sono
rimasti invariati. [Report completo](results/uniform-http/report.md),
[JSON autosufficiente](results/uniform-http/results.json) e
[contesto con immagini, versioni e hash](results/uniform-http/run-context.json).
Le sei esportazioni rigenerate offline sono byte-identiche agli originali.
`.gitattributes` conserva i byte dei receipt anche con `core.autocrlf=input`.
I container temporanei sono stati rimossi. Non sono state misurate performance.
[Audit indipendente finale: PASS](results/uniform-http/audit.md), con matrici ricomputate
dalle osservazioni senza usare lo scorer del runner.

## Comandi dalla root

```sh
rtk proxy python3 tests/evaluation/runner.py --validate-only
rtk proxy python3 -m unittest discover -s tests/evaluation/tests -v
```

Dopo review indipendente del gold e readiness dei **tre** servizi locali:

```sh
rtk proxy python3 tests/evaluation/runner.py \
  --gold tests/evaluation/gold.json \
  --rizzo-url "$RIZZO_URL" --horizon-url "$HORIZON_URL" --presidio-url "$PRESIDIO_URL" \
  --timeout 60 --output tests/evaluation/results/uniform-http
```

Le URL sono basi loopback con la porta effettiva, senza `/v1/analyze`.
Il parent gestisce immagini, readiness e cleanup; il runner non avvia processi/container.
La directory di output deve essere nuova: se esiste, nessun POST parte.
Nessun retry selettivo o redirect HTTP. Non usare provider esterni per questo pilot.

Render offline del **solo schema 2**, senza gold corrente né rete:

```sh
rtk proxy python3 tests/evaluation/runner.py \
  --render tests/evaluation/results/uniform-http/results.json \
  --output tests/evaluation/results/uniform-http-rendered
```

Exit: `0` completo/preflight; `2` receipt incompleto (o errore argomenti); `3` input/output
invalido. HTTP non-200, timeout e trasporto sono errori tecnici; JSON/schema/ordine/duplicati
invalidi sono errori contrattuali. Ctrl-C durante una richiesta registra `INTERRUPTED`,
lascia le altre `unattempted` e salva il receipt incompleto. Un disco indisponibile,
un hard kill o un crash non garantiscono un receipt; scritture parziali sono possibili.
Non è un sistema di resume. Un exit nonzero non autorizza a inventare risultati mancanti.

## Protocollo e misura

- Identico per `rizzo`, `horizon`, `presidio`:
  `{fields:[{fieldId,text,allowedCategories}]}` →
  `{verdict,findings:[{fieldId,category}]}`. Catalogo chiuso a nove categorie.
- Detection: allowlist vuote, presenza categoria per **caso/campo**, non span o numero
  di entità. Policy: seconda richiesta con le allowlist originali del caso, non un
  verdetto ricostruito dalla detection. Un permesso non si trasferisce ad altri campi.
- Il collector valida prima dell'uso l'ordine lessicografico UTF-16 per fieldId/category,
  unicità, categorie, fieldId, allowlist e coerenza verdict/findings. Conserva in
  `observation.response` l'oggetto business ricevuto, senza riordinarlo o deduplicarlo.
  Label native extra sono **contract failure**, non vengono filtrate dal runner.
- Matrici su successi **appaiati fra tutti e tre** per ciascun probe e fonte; coverage
  propria separata per motore. Policy fallita non cancella detection riuscita.
  Fallimenti/non tentati non diventano TP/FP/FN/TN. Unknown esclusi esplicitamente, mai TN.
- Sensibilità/recall=TP/(TP+FN), precisione=TP/(TP+FP), accuracy=(TP+TN)/N;
  balanced accuracy=media di recall e specificità quando entrambe definite.
  Positivo policy=`rejected`; false acceptance=FN/(TP+FN), false rejection=FP/(FP+TN).
  Denominatore zero: `null` JSON, cella vuota CSV, `N/A` Markdown.
- Bundle autosufficiente e sanitizzato: ID/fonti/famiglie/provenance, categorie attese,
  unknown, allowlist e risposte business/codici. Nessun testo di input, span, nota libera
  o body d'errore. Un textId stabile nel bundle collega gli input ripetuti senza esportarli.
  Render verifica schema, riferimenti e metriche; non certifica autenticità contro
  modifiche coordinate. Non servono capability baseline o mappe native nel runner.

## Gold e review

| Fonte | Casi | Campi | Testi distinti | Famiglie dichiarate |
| --- | ---: | ---: | ---: | ---: |
| Rizzo `clean/val` | 10 | 10 | 10 | 2 |
| Gretel `Italian_test` | 18 | 18 | 18 | 4 |
| Mirati originali | 25 | 26 | 26 | 21 |
| Legacy selezionati | 38 | 38 | 28 | 21 |
| **Totale** | **91** | **92** | **82** | **48** |

**546 POST pianificati**, massimo due campi/caso e 50 parole Unicode White_Space/campo.
Policy attesa: **66 rejected, 25 accepted, zero unknown**. Detection: **13 coppie unknown**
(sei IT_IDENTITY_CARD, sette IT_DRIVER_LICENSE); non sono negativi.

I primi **53 oggetti caso / 54 testi** restano identici, incluse annotazioni/provenance.
Sono aggiunti 28 testi letterali del ref `38360c8d7f776c075457e319bd957502a03c963b`,
con 38 scenari originali, senza generare testi o importare il resto del corpus.
Per ogni import: ID/indice/ref/famiglia/scenario originali e motivo della selezione.
Le annotazioni sono rilette secondo il goal attuale: quattro vecchi negativi checksum
sono positivi; telefoni/documenti italiani, IBAN/carte internazionali; omocodia
riconoscibile consentita. Il source non offre un caso completo di omocodia o telefono
estero da importare: il gap resta dichiarato, non viene riempito artificialmente.

**Review implementatore completa:** 82/82 testi distinti, 91 scenari, 92 campi e tutte
le 828 decisioni campo/categoria. `REVIEW.md` contiene registro esaustivo, tutti i 38
ID aggiunti e i motivi. **Review indipendente completata prima delle nuove predizioni:**
`deleg_535a5d99`, task 3, PASS su tutti gli 82 testi, 91 scenari e 828 decisioni; nessuna
correzione alle annotazioni. È una review di agente, non validazione umana. Le vecchie
attestazioni restano provenance storica; `mergedReview` approva il pilot consolidato.

## Verifica e limiti

La suite standard library esercita il vero CLI con tre server HTTP finti su loopback,
inclusi tutti i 546 POST del pilot, JSON/CSV/Markdown, render standalone byte-identico,
full/partial/wrong allowlist, multifield Unicode, unknown, conteggi per fonte,
ordine UTF-16, duplicati, extra nativi, HTTP 400/503/non-200/redirect, timeout,
JSON/UTF-8/chunk invalidi, risposta troppo grande, interruzione e write failure.
Questi sono test dell'harness, **non metriche dei detector reali**. Le coppie checksum
sono controllate con funzioni indipendenti; non serve pyarrow o una cache scaricata.

Pilot **non heldout**: gli input originali erano già stati valutati. Famiglie e varianti
policy sono correlate; i probe detection ripetuti per scenario pesano nelle matrici.
La famiglia maggiore è Gretel CSV (11 casi/testi); sette Rizzo sono thread correlati.
I 92 campi non sono 92 testi indipendenti. Nessuna rappresentatività di produzione,
certezza di assenza dal training, misura performance o garanzia di non assegnazione.
Un `accepted` non certifica assenza di dati personali. Non fare tuning sulle predizioni.

I sette file del vecchio run sono preservati byte-per-byte in
`results/historical/first-http/`, con spiegazione in `results/historical/README.md`:
**snapshot storico a due motori, non confrontabile e non ricalcolabile con il nuovo
protocollo**. Il reader storico non è più operativo; il render corrente rifiuta schema 1.
