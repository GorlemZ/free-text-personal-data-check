# PoC Rizzo

Servizio Node.js 24: modello Rizzo ONNX, pipeline standard Transformers.js `token-classification` e regole TypeScript. [Contratto HTTP comune](../tests/contract/README.md) · [Test](../tests/README.md) · [Valutazione](../tests/evaluation/README.md).

## Avvio dalla root

```sh
npm --prefix poc-rizzo ci
npm --prefix poc-rizzo run typecheck
npm --prefix poc-rizzo run build
npm --prefix poc-rizzo test
npm --prefix poc-rizzo run prefetch
npm --prefix poc-rizzo run smoke
npm --prefix poc-rizzo start
```

`build` elimina prima l'intera directory `dist` e compila tutti i sorgenti e CLI con TypeScript strict (NodeNext). Il runtime usa soltanto `dist/index.js`; i test importano il codice compilato e `npm test` esegue il build prima della suite, anche quando invocato dall'harness centralizzato. L'import dei moduli e delle CLI non avvia server, caricamento del modello o download. Dopo modifiche ai sorgenti, ripetere typecheck e build.

`prefetch` scarica gli artefatti fissati in [model-manifest.json](model-manifest.json); `smoke` esegue inferenza reale e verifica PERSON, email in coda e gestione dell'overflow token. Il servizio usa solo modelli locali. Bind predefinito `127.0.0.1:8000`, configurabile con `BIND_HOST` e `PORT`.

Dopo il prefetch:

```sh
docker build -t free-text-check:rizzo-uniform ./poc-rizzo
docker run --rm -p 127.0.0.1:18081:8000 free-text-check:rizzo-uniform
```

Attendere `GET /health/ready`. Il container finale non contiene Python. Per uno smoke reale senza rete, sull'immagine già costruita:

```sh
docker run --rm --network none free-text-check:rizzo-uniform node dist/scripts/smoke.js
```

## Startup, budget e ammissione

La composition root legge la configurazione prima dell’uso e attende una sola inizializzazione esplicita del modello prima del listen. L’adapter pronto contiene la funzione di inferenza: nessuna cache lazy, `let` o retry implicito. Integrità, modello/tokenizer o configurazione non validi impediscono l’avvio; gli import e il build restano privi di caricamenti.

- `ANALYZER_TOKEN_BUDGET`: intero positivo sicuro, non oltre il minimo dei limiti modello/tokenizer. Se omesso, usa quel limite (8192 nel modello corrente), come prima. Un controllo esterno per campo con `truncation:false`, `padding:false`, `add_special_tokens:true`, immediatamente prima della pipeline standard. Si contano anche i token speciali; la tokenizzazione interna della pipeline resta necessaria, senza tokenizer custom. Overflow: 503 senza risultati parziali.
- `ANALYZER_CONCURRENCY`: intero positivo sicuro, default **1**. Ogni app ha un limiter privato `p-limit@6.2.0`, acquisito dopo validazione per l’intera richiesta e la sua proiezione. `activeCount + pendingCount` e `limit(task)` nello stesso turno sincrono evitano overbooking prima dei microtask; richieste eccedenti ricevono subito 503 senza esecuzione, non aspettano in coda.
- Health è indipendente dal limiter. Lo slot si libera solo quando il task termina realmente, anche in errore: timeout/disconnessione del client non cancellano inferenza né liberano capacità anticipatamente. Stato interno della libreria accettato; nessun contatore applicativo mutabile. Limite per istanza app/processo, non distribuito fra processi.

## Pipeline NLP comune

Rizzo e [Horizon](../poc-horizon/README.md) delegano esecuzione ONNX e aggregazione delle entità alla pipeline standard Transformers.js 4.3.2, con `aggregation_strategy: 'simple'`. Nessun decoder BIO, aggregatore o softmax applicativo. Restano specifici dei servizi modelli, tokenizer, soglie, mapping, regole e policy.

```text
HTTP → controllo preventivo token → TokenClassificationPipeline
     → mapping e soglia del modello → regole locali → policy
```

Il caricamento usa gli artefatti locali originali, verificati con il manifest. La preflight senza troncamento precede la pipeline, che altrimenti troncherebbe silenziosamente. Il servizio valida le entità restituite dalla libreria; non ispeziona più i logits dei token filtrati. Questo cambia il confine di validazione rispetto al vecchio decoder Rizzo e non implica identità delle detection. La compatibilità reale e il limite di memoria vanno verificati separatamente dalle suite con inferenza sintetica.

## Detection e limiti

- Il tokenizer riceve l'intero testo; l'overflow produce un errore tecnico invece di troncare l'input.
- Le entità aggregate standard vengono proiettate nel catalogo comune con la soglia Rizzo `0.5`. `ID_DOC` generico resta escluso dai documenti italiani; etichette note fuori catalogo sono ignorate. Entità restituite malformate o etichette sconosciute causano errore tecnico; i token eliminati dalla pipeline non sono sottoposti a un decoder o validatore raw custom.
- Il risultato del modello dipende da label e score: nessun veto di checksum, forma, span o geografia. `word` assente/vuoto è ammesso; se presente deve essere una stringa. Non si ricostruiscono offset.
- `analysisServiceBuilder` coordina il detector modello (inferenza + mapping), la funzione pura `recognize` e la policy per campo. Il builder regole pass-through è eliminato; DTO/collezioni esposti sono readonly, senza candidates/possible. Un errore modello impedisce le regole e non produce risultati parziali. Ogni campo completa budget → pipeline → mapping → regole → policy prima del successivo. Un errore tardivo invalida l’intera risposta, anche se campi precedenti sono già stati elaborati.

### Matrice statica categoria/fonte

`CATEGORY_SOURCES` assegna una sola fonte per categoria. Le regole non recuperano omissioni o score sotto soglia del modello.

| Categoria | Fonte esclusiva | Mapping / motivazione |
|---|---|---|
| PERSON | modello | `FULLNAME` |
| EMAIL_ADDRESS | modello | `EMAIL` |
| PHONE_NUMBER | modello | `TELEPHONENUM`, senza filtro geografico |
| IT_FISCAL_CODE | modello | label specifica italiana `CF`, non dedotta da un generico tax ID |
| IT_VAT_CODE | modello | label specifica italiana `PIVA` |
| IBAN_CODE | modello | `IBAN` |
| CREDIT_CARD | modello | `CREDITCARDNUMBER` |
| IT_IDENTITY_CARD | regole | `ID_DOC`/`DOCID` generici non distinguono identità e nazionalità |
| IT_DRIVER_LICENSE | regole | nessuna label nativa specifica per patente italiana |

Restano solo regole integrative per CIE e patenti, con formati italiani, confini Unicode e contesto nei 50 caratteri precedenti oppure valore standalone. Le regole email/CF/P.IVA/IBAN/carte/telefoni sono rimosse dal percorso, non tenute come fallback. La dipendenza inutilizzata `ibantools` e la fixture del decoder BIO storico sono rimosse. I test della pipeline standard mantengono casi sintetici di raggruppamento, token speciali, Unicode, soglia, output invalido, errori e budget senza eseguire il decoder ritirato. I test `legacy-config`, `legacy-manifest` e `legacy-prefetch` restano: verificano ancora confini CLI/configurazione correnti, non detection superata.

Il modello può classificare telefoni esteri: `PHONE_NUMBER` non è una label specificamente italiana. Il gold italiano rimane invariato; la rimozione del filtro geografico può aumentare falsi positivi e la rimozione del recupero regole può aumentare omissioni. La matrice descrive responsabilità/mapping, non garantisce qualità né copertura empirica. La policy di allowlist è invariata.

Il pin `onnxruntime-node@1.30.0`, condiviso con Transformers.js, evita ABI native incompatibili. Una regressione sul lockfile ne verifica l'unicità.

## Modello e licenza

Sorgente `rizzoaiacademy/rizzo-pii-0.3B`; export community `andrearuffini/local-privacy-runtime-pii-detector`. Revisioni e hash sono nel manifest, licenza dell'export in [MODEL_LICENSE](MODEL_LICENSE). La parità PyTorch/ONNX è dichiarata dall'autore. I testi Rizzo del pilot condividono provenienza con il modello: considerare questa dipendenza nell'interpretazione delle metriche.

## Confine HTTP, parsing standard e stato

Il buffering è delegato alla dipendenza diretta esatta `raw-body@2.5.2` in modalità
Buffer, con limite di **1 MiB sui byte effettivamente ricevuti**, senza fidarsi di
`Content-Length` né anticipare l’errore sulla sola lunghezza dichiarata. Il decoder
UTF-8 resta `fatal: true, ignoreBOM: true`: byte invalidi/troncati e BOM iniziale
sono rifiutati (400); il superamento byte resta 413. Il framing malformato, incluso
`Content-Length` non valido, è gestito da Node prima del listener applicativo.
Horizon drena il body rifiutato e conserva la connessione; Rizzo drena e mantiene
`Connection: close` sul 413. Content-type e routing precedono la lettura del body;
schema precede ammissione/inferenza. Una disconnessione durante il body non avvia
inferenza; quella durante inferenza non libera anticipatamente la capacità.

**Differenza deliberata:** `JSON.parse` standard sostituisce gli scanner custom.
Chiavi JSON duplicate (anche con escape equivalenti) usano **l’ultimo valore**;
si valida lo schema risultante. Un valore precedente scartato, anche con surrogate
isolate, non viene più ispezionato; chiavi sconosciute e valori finali invalidi
restano vietati. `fieldId` ripetuti fra campi restano invalidi; ID e testo finali
sono verificati con `isWellFormed()`. Limiti Unicode, parole, categorie e risultato
business restano invariati. Questa scelta non modifica il parser di Presidio:
l’harness condiviso dichiara le tre aspettative last-wins per i soli motori Node.

Il codice applicativo usa valori readonly, `map`/`every`, Set costruiti senza
`.add` e ordinamento non mutante. Il controllo AST copre tutti gli entrypoint
runtime e CLI e i relativi import locali; non certifica immutabilità dell’intero
processo. Stato di buffer e scheduling appartiene rispettivamente a `raw-body`
e `p-limit`; stream, socket, filesystem, processo e SDK restano confini mutabili
espliciti. Gli smoke reali non sono eseguiti dai gate sintetici: nessuna prova di
qualità del modello è implicita in queste verifiche.
