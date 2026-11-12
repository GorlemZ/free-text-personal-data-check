# Pilot comparativo

`gold.json` → due POST per caso e motore → JSON, CSV e Markdown. Il runner usa la standard library Python e comunica con tre servizi HTTP già avviati. Il gold è statico: preflight e test lo leggono senza rigenerarlo.

[Contratto HTTP](../contract/README.md) · [Suite automatiche](../README.md) · [Registro annotazioni e provenienza](REVIEW.md)

## Eseguire un confronto

Dalla root, validare il gold:

```sh
python3 tests/evaluation/runner.py --validate-only
```

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
  --render tests/evaluation/results/uniform-http/results.json \
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

| Fonte | Casi | Campi | Testi distinti | Famiglie |
|---|---:|---:|---:|---:|
| Rizzo `clean/val` | 10 | 10 | 10 | 2 |
| Gretel `Italian_test` | 18 | 18 | 18 | 4 |
| Mirati | 25 | 26 | 26 | 21 |
| Legacy selezionati | 38 | 38 | 28 | 21 |
| **Totale** | **91** | **92** | **82** | **48** |

Il pilot prevede **546 POST**, 66 rifiuti e 25 accettazioni. Le 13 coppie detection `unknown` riguardano sei carte d'identità e sette patenti. Telefoni e documenti hanno portata italiana; email, IBAN e carte internazionale. Identificativi riconoscibili con checksum errato restano positivi.

I 53 casi originali sono conservati; 38 scenari sono importati da 28 testi letterali del ref `38360c8d7f776c075457e319bd957502a03c963b`, con ID, indice, scenario e motivo della selezione. Quattro vecchi negativi checksum sono stati riannotati positivi. Il sorgente legacy non offriva un esempio completo di omocodia o telefono estero da importare: questi gap restano dichiarati.

[REVIEW.md](REVIEW.md) documenta la revisione di tutti gli 82 testi, 91 scenari e 828 decisioni campo/categoria. Review indipendente di agente completata prima delle predizioni, senza correzioni richieste; nessuna validazione umana dichiarata. Gold, provenienza e annotazioni restano separati dalle risposte dei motori.

## Risultati e interpretazione

Il run **12 novembre 2026** ha completato **546/546 richieste** con zero errori tecnici o contrattuali. Le sei esportazioni sono state rigenerate byte-identiche e le matrici ricontate indipendentemente:

[Report](results/uniform-http/report.md) · [JSON](results/uniform-http/results.json) · [Contesto del run](results/uniform-http/run-context.json) · [Audit](results/uniform-http/audit.md)

Gli artefatti descrivono lo snapshot funzionale pubblicato in `8dab3a9`; la successiva pulizia di documentazione e commenti conserva quei file. Gli hash dei sorgenti nel contesto si riferiscono alla versione eseguita.

Il campione è **non heldout**: gli input originali erano già stati valutati e Rizzo condivide provenienza con il modello. Varianti policy e famiglie sono correlate; le ripetizioni della prova detection per scenario pesano nelle matrici. La famiglia maggiore è Gretel CSV, con 11 testi; sette testi Rizzo sono thread correlati. Le percentuali descrivono questo campione. `accepted` resta un esito euristico; nessun tuning è stato effettuato sulle predizioni. Performance e memoria richiedono misure separate.

Gli [snapshot storici](results/historical/README.md) restano separati: hanno due motori e cataloghi differenti. Il renderer corrente rifiuta lo schema 1; i vecchi dati restano consultabili nell'archivio.
