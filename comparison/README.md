# Confronto funzionale via HTTP e Docker

La suite legge il gold, invia richieste HTTP ai due servizi Docker, associa le risposte agli ID dei casi e confronta atteso e osservato. Produce tabelle di sensibilità/precisione e correttezza del verdetto. Non misura memoria, CPU, latenza o throughput. Un run completo è sufficiente per la prima tabella.

## Un solo gold corrente

`corpus.json` contiene testi sintetici e risposte attese. `manifest.json` descrive policy, provenienza, conteggi e review: **non contiene hash**. La configurazione descrittiva `functional/capabilities.json` elenca mapping e percorsi supportati; non richiede un'approvazione separata né digest immagine compilati a mano.

Catalogo fisso: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`. Tutte le categorie sono vietate salvo allowlist del campo. Le categorie note fuori catalogo non devono causare rifiuto. Non equiparare label generiche come TAX_ID a identificativi nazionali.

- **PERSON:** nome e cognome, anche isolati; un solo nome/cognome richiede contesto personale chiaro. Organizzazioni, luoghi e parole ambigue sono negativi.
- **EMAIL_ADDRESS:** indirizzo sintatticamente valido, anche generico/aziendale o con dominio a etichetta singola; nessuna verifica DNS o consegna.
- **PHONE_NUMBER:** qualsiasi paese con prefisso `+`/`00`, default IT senza prefisso; validità dei metadati sull'intero candidato, senza recuperare sottostringhe da numeri malformati.
- **IT_FISCAL_CODE:** canonico con checksum e confini, anche lowercase; omocodia fuori perimetro, non dichiarata amministrativamente invalida.
- **IT_VAT_CODE:** 11 cifre e checksum, prefisso `IT` compatto opzionale; tutte zero negativo. Una sequenza valida separata da `IT ` resta un candidato autonomo.
- **IBAN_CODE:** italiano, 27 caratteri normalizzati, mod97 e spazi ASCII; nessuna verifica di CIN domestico o assegnazione.
- **CREDIT_CARD:** 13–19 cifre ASCII e Luhn, spazi/trattini; nessuna verifica di emittente o assegnazione.

`expectedEntities` elenca tutte le categorie presenti, non soltanto quella su cui si concentra il caso. Il gold include positivi isolati/in contesto, negativi mirati, checksum e confini, distrattori fuori catalogo, sovrapposizioni e allowlist vuote/complete/parziali/errate. Le varianti correlate condividono la famiglia; non sono campioni indipendenti. La versione dei metadati telefonici usati per annotare il gold è dichiarata nel manifest.

Il gold viene revisionato indipendentemente dalle predizioni. Lo stato effettivo è `manifest.review`, con reviewer e data; una review indipendente dell'agente non è un'approvazione umana. La rigenerazione sovrascrive corpus/manifest e riporta la review a pending. I dati sono sintetici, ma la non assegnazione non è garantita: non contattare recapiti né tentare transazioni.

## Esecuzione

Dalla root, con Node.js ≥22, dipendenze dei due PoC e asset tokenizer/modello Horizon già disponibili:

```sh
node --test comparison/tests/*.test.mjs
node comparison/functional/run.mjs --validate-only
```

Questi comandi verificano schema, associazioni, calcoli e tokenizer locale; non interrogano i detector reali. Alcuni test usano server HTTP finti e il Python locale `poc-spacy/.venv/bin/python` per controlli gold indipendenti. `--validate-only` segnala anche la review pending senza avviare Docker. Per rigenerare esplicitamente il gold:

```sh
poc-spacy/.venv/bin/python comparison/generate-gold.py
```

Dopo la review del gold, costruire i servizi ed eseguire il confronto:

```sh
docker build --pull=false -t free-text-check:presidio-http-gold poc-spacy
docker build --pull=false -t free-text-check:horizon-http-gold poc-horizon
node comparison/functional/run.mjs \
  --presidio-image free-text-check:presidio-http-gold \
  --horizon-image free-text-check:horizon-http-gold \
  --output-dir comparison/reports/run-01
```

La build può scaricare dipendenze. Il runner usa immagini locali già costruite, avvia per image ID con `--pull never`, registra l'immagine effettiva e la versione policy osservata, e richiede che quest'ultima resti coerente nel run. Non modifica il gold e non corregge le risposte attese in base ai risultati.

I container vengono avviati **uno alla volta**, con porta pubblicata su `127.0.0.1`, rete bridge predefinita e modelli configurati offline. Questo binding non prova isolamento egress. Nessuna autenticazione è prevista dall'attuale API locale; non esporla pubblicamente. Readiness, timeout e un piccolo smoke contrattuale precedono i casi misurati; lo smoke non impone una soglia di accuratezza. Il runner rimuove soltanto i propri container anche in caso di errore o interruzione.

## Richieste e risultati

- **Detection:** una richiesta per testo distinto, con allowlist vuota. Duplicati sono ammessi soltanto se gold, split e famiglia concordano; viene usato il campo della prima riga. I collegamenti agli scenari restano nel risultato.
- **Policy:** una richiesta per ogni scenario con la sua allowlist. Si confronta il verdetto reale, senza ricostruirlo dalla detection.

L'API espone solo finding vietate: una risposta accepted con allowlist non permette di misurare tutte le categorie riconosciute. Le due serie di richieste verificano aspetti differenti. Un timeout/503/interruzione è un errore tecnico; una risposta invalida è un errore contrattuale. Entrambi restano fuori da TP/FP/FN/TN. Un errore contrattuale interrompe la raccolta; i casi rimanenti risultano non tentati. Errori di trasporto/503 senza interruzione vengono registrati e la raccolta prosegue, senza retry selettivi.

Ogni nuova directory contiene:

- `results.json`: ID, gold categorie/verdetto, allowlist, metadati consentiti e osservazioni per motore/probe;
- `run-manifest.json`: stato, conteggi previsti, immagini e policy osservate, rete effettiva, riferimento Git e stato dirty;
- `summary.json`, `sensitivity.csv`, `verdict.csv`, `report.md`: conteggi e tabelle.

I risultati non contengono testi, span, body HTTP grezzi o motivazioni libere. Lo schema viene verificato prima della scrittura. Il collegamento è **ID → atteso → risposta**, senza hash di corpus/manifest/capability. La directory di output deve essere nuova.

Le tabelle confrontate usano gli stessi casi riusciti su entrambi i motori, separatamente per detection e policy. I conteggi per il singolo motore e la copertura sono disponibili in JSON/CSV. N+/N− e TP/FP/FN/TN accompagnano sensibilità e precisione. Per la policy il positivo è `rejected`: sono riportate accuracy, accettazioni/rifiuti indebiti e relativi denominatori condizionati. L'uguaglianza del set di categorie è misurata **all'interno del catalogo**; eventuali extra label restano diagnostiche. Denominatore zero significa null/N/A.

Per ricalcolare da un risultato salvato senza rileggere il gold corrente né avviare servizi:

```sh
node comparison/functional/run.mjs --render comparison/reports/run-01/results.json \
  --output-dir comparison/reports/run-01-render
```

Il render verifica schema e coerenza interna, non autentica il file. Supporta anche il catalogo dei bundle storici, esplicitamente indicato nel report; non rietichetta le osservazioni secondo il gold corrente. Le copie locali storiche sono conservate in `reports/historical/`.

Il campione è development, non held-out e non rappresentativo della prevalenza produttiva. `accepted` non dimostra assenza di dati personali; la percentuale di test automatici verdi non è l'accuratezza dei detector.
