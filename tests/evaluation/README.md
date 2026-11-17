# Pilot comparativo

`gold.json` → due POST per caso e motore → JSON, CSV e Markdown. Il runner usa la standard library Python e comunica con tre servizi HTTP già avviati. Il gold è statico: preflight e test lo leggono senza rigenerarlo.

[Contratto HTTP](../contract/README.md) · [Suite automatiche](../README.md) · [Registro annotazioni](REVIEW.md) · [Fonti e licenze](SOURCES.md)

## Eseguire un confronto

Dalla root, validare il gold:

```sh
python3 tests/evaluation/runner.py --validate-only
```

Per verificare che i 60 testi aggiunti coincidano con le righe dei Parquet fissati per revisione e SHA-256, usare una cache esterna al repository:

```sh
uv run --with pyarrow python tests/evaluation/verify_sources.py \
  --cache-dir "$TMPDIR/golden-source-verification"
```

Il verificatore scarica soltanto i due artefatti dichiarati in [SOURCES.md](SOURCES.md), controlla hash, numero di righe, testo, span e metadati di provenienza selezionati, senza stampare i testi.

Avviare i servizi seguendo i README [Rizzo](../../poc-rizzo/README.md), [Horizon](../../poc-horizon/README.md) e [Presidio](../../poc-presidio/README.md). Con le porte degli esempi, attendere `GET /health/ready` su `18081`, `18082` e `18083`, quindi scegliere una directory di output **che non esista**:

```sh
python3 tests/evaluation/runner.py \
  --gold tests/evaluation/gold.json \
  --rizzo-url http://127.0.0.1:18081 \
  --horizon-url http://127.0.0.1:18082 \
  --presidio-url http://127.0.0.1:18083 \
  --timeout 60 --output tests/evaluation/results/my-run
```

Cambiare `my-run` per ogni esecuzione. Una directory esistente impedisce l'invio delle richieste. Le URL sono basi loopback senza `/v1/analyze`; il runner non avvia né ferma container. Il loro arresto è responsabilità di chi li avvia. Nessun redirect o retry selettivo delle predizioni.

Per rigenerare i report da un bundle schema 2, senza rete o gold corrente, scegliere un altro percorso nuovo:

```sh
python3 tests/evaluation/runner.py \
  --render tests/evaluation/results/main-2026-11-17/results.json \
  --output tests/evaluation/results/my-render
```

### Output ed errori

`results.json` conserva casi annotati e risposte business; `observations.csv` gli esiti delle richieste, `detection.csv` e `verdict.csv` le matrici, `coverage.csv` la copertura e `report.md` la sintesi. I bundle escludono testi, span, score, note libere e body d'errore. Git preserva anche i terminatori CRLF dei CSV.

Exit code: `0` completo/preflight, `2` raccolta incompleta o errore argomenti, `3` input/output invalido. HTTP non-200, timeout e trasporto sono errori tecnici; JSON, schema, ordine o duplicati invalidi sono errori contrattuali. Ctrl-C durante una richiesta registra `INTERRUPTED`, lascia le successive `unattempted` e tenta di salvare il risultato incompleto. Hard kill, crash o disco indisponibile possono lasciare scritture parziali. Ripartenza automatica non prevista.

## Metodo

- **Detection:** allowlist vuota, presenza di ogni categoria per caso/campo. Più entità della stessa categoria contano come una presenza.
- **Policy:** seconda richiesta reale con le categorie consentite dal caso. Il verdetto viene osservato via HTTP, senza ricostruirlo dalla prima risposta.
- I tre servizi ricevono input identici. Il collector verifica ordine UTF-16, unicità, categorie, campi, allowlist e coerenza del verdetto **prima** di usare la risposta, conservata in `observation.response`. Categorie extra sono errori di contratto.
- Le matrici confrontano i casi riusciti su tutti e tre i motori, separatamente per prova e fonte. La copertura propria resta visibile. Errori, richieste non tentate e coppie `unknown` sono esclusi dai conteggi; una policy fallita non elimina la detection riuscita.
- Sensibilità = TP/(TP+FN); precisione = TP/(TP+FP); accuracy = (TP+TN)/N; balanced accuracy = media di sensibilità e specificità. Denominatori zero: `null` JSON, cella vuota CSV, `N/A` Markdown.
- Positivo policy = **rifiuto atteso**. FN è una falsa accettazione, FP un falso rifiuto. I risultati misurano presenza di categorie e verdetti, con supporti espliciti per ogni metrica.

## Campione e annotazioni

Gold corrente: **`uniform-pilot-3`**, con 60 nuovi testi distinti rispetto ai 91 casi precedenti, conservati integralmente.

| Fonte | Casi | Campi | Testi distinti | Famiglie dichiarate |
|---|---:|---:|---:|---:|
| Rizzo `clean/val` | 10 | 10 | 10 | 2 |
| Gretel `Italian_test` | 48 | 48 | 48 | 12 |
| Mirati | 25 | 26 | 26 | 21 |
| Legacy selezionati | 38 | 38 | 28 | 21 |
| AliasIT v5 `test` | 30 | 30 | 30 | 29 |
| **Totale** | **151** | **152** | **142** | **85** |

Un confronto completo sul gold corrente prevede **906 POST**, con **98 rifiuti e 53 accettazioni attesi**. Le 13 coppie detection precedentemente `unknown` sono state classificate manualmente come assenti: il gold corrente contiene zero `unknown`. Il confronto reale 906/906 pubblicato sotto resta riferito al gold precedente alla decisione; i suoi risultati storici non sono stati ricalcolati. Telefoni e documenti hanno portata italiana; email, IBAN e carte internazionale. Identificativi riconoscibili con checksum errato restano positivi.

Le aggiunte sono 30 testi Gretel e 30 AliasIT; `provenance.cohort = external-expansion-1` consente di identificarle anche nelle proiezioni dei nuovi risultati. Testi completi, whitespace e annotazioni upstream sono conservati senza generazione o tagli locali. Dataset, revisioni, indici, trasformazioni già presenti alla fonte e licenze sono documentati in [SOURCES.md](SOURCES.md). La componente Gretel comprende anche formati strutturati/inglesi e record frammentari già all'origine: non è interamente prosa italiana naturale.

La review indipendente del delta ha risolto sei casi inizialmente marcati incerti: forma IVA riconoscibile positiva, forme documentali non italiane negative. **I 60 nuovi casi sono difficili ma decidibili secondo il catalogo; non aggiungono nuove ambiguità intrinseche.** Le 13 decisioni manuali successive riguardano i casi precedenti. Il runner esclude dalle matrici solo le coppie effettivamente `unknown` nel gold fornito: nel gold corrente sono zero.

[REVIEW.md](REVIEW.md) distingue la revisione storica dei 91 scenari dalla review delle 540 nuove decisioni campo/categoria; copertura cumulativa: 142 testi, 151 scenari, 1.368 decisioni. Nessuna validazione umana dichiarata e nessuna selezione basata su predizioni. I conteggi di famiglia non attestano indipendenza: dieci wrapper AliasIT sono inoltre marcati con un gruppo di correlazione comune.

## Risultati e interpretazione

Il run **17 novembre 2026**, eseguito prima della decisione manuale sulle 13 coppie, sul commit applicativo `ce5d395818760f73e1ea17879d22cb158295f110` ha completato **906/906 richieste** sui tre motori, con zero errori tecnici o contrattuali e nessun retry selettivo. Le sei esportazioni sono state rigenerate offline byte-identiche:

[Report storico del 17 novembre](results/main-2026-11-17/report.md) · [JSON](results/main-2026-11-17/results.json) · [Contesto del run](results/main-2026-11-17/run-context.json)

Sul verdetto HTTP, Horizon ha ottenuto TP=97, FP=7, FN=1, TN=46; Rizzo TP=94, FP=12, FN=4, TN=41; Presidio TP=78, FP=12, FN=20, TN=41. Sono risultati descrittivi non heldout, senza soglia di promozione. Le directory `horizon-typescript-2026-11-16` e `uniform-http` conservano i precedenti pilot a 91 scenari e non devono essere aggregate al run corrente.

Il contesto registra commit applicativo, digest delle immagini effettivamente eseguite, hash di gold/runner/esportazioni e cleanup dei container. Il bundle non contiene i testi del corpus, span, score, note libere o body di errore.

Il campione è **non heldout**: gli input originali erano già stati valutati e Rizzo condivide provenienza con il modello. Varianti policy e famiglie sono correlate; le ripetizioni della prova detection per scenario pesano nelle matrici. La famiglia maggiore dichiarata è Gretel CSV, con 13 testi; sette testi Rizzo sono thread correlati. I wrapper AliasIT hanno correlazioni ulteriori documentate in REVIEW.md. Le percentuali descrivono questo campione. `accepted` resta un esito euristico; nessun tuning è stato effettuato sulle predizioni. Performance e memoria richiedono misure separate.

Il renderer corrente supporta soltanto lo schema 2 e rifiuta i bundle schema 1.
