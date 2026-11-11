# Confronto funzionale via HTTP e Docker

La suite legge il gold, invia richieste HTTP ai due servizi Docker, associa le risposte agli ID dei casi e confronta atteso e osservato. Produce tabelle di sensibilità/precisione e correttezza del verdetto. Non misura memoria, CPU, latenza o throughput. Un run completo è sufficiente per la prima tabella.

## Un solo gold corrente

`corpus.json` contiene **290 stringhe letterali complete**; `gold.json` contiene **329 annotazioni/scenari policy** collegati tramite `textIndex` (39 scenari riusano testi). Il loader invia la stringa esatta, senza composizione runtime; `fieldId` è soltanto metadata HTTP. Corpus e annotazioni sono **revisionati e congelati per il prossimo confronto**. `manifest.review` registra reviewer e data, senza hash. La review indipendente completa è stata integrata da un controllo mirato delle ultime 56 riscritture, senza rilievi sostanziali. Il mapping semantico↔nativo risiede soltanto in `functional/category-map.mjs`; `functional/capabilities.json` descrive supporti e percorsi applicativi.

Il `fieldId` resta metadata del wrapper HTTP: le frasi non sono dichiarate rappresentative del contenuto reale di ogni campo nominato. Il confronto è appaiato sugli stessi testi, non una stima di prevalenza o usabilità per campo.

Il catalogo **semantico** del gold ha nove categorie: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`. Tutte sono vietate salvo allowlist del campo. Le categorie native note fuori catalogo non causano rifiuto; `TAX_ID`, `BANK_ACCOUNT` e `LICENSE_NUMBER` non vengono assimilate a CF/IVA, IBAN o patente.

| Categoria gold | Presidio (API) | Horizon (API) |
| --- | --- | --- |
| `PERSON` | `PERSON` | `PERSON` |
| `EMAIL_ADDRESS` | `EMAIL_ADDRESS` | `EMAIL` |
| `PHONE_NUMBER` | `PHONE_NUMBER` | `PHONE` (modello), `PHONE_NUMBER` (regola) |
| `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD` | gli stessi nomi | gli stessi nomi delle regole |
| `IT_IDENTITY_CARD` | `IT_IDENTITY_CARD` | `NATIONAL_ID` |
| `IT_DRIVER_LICENSE` | `IT_DRIVER_LICENSE` | `DRIVER_LICENSE` |

Ogni richiesta policy espande l'allowlist gold in **tutte** le label native corrispondenti (nove su Presidio, dieci su Horizon quando è completa); findings e verdetto HTTP restano nativi. Soltanto il comparatore proietta e deduplica le label per le metriche, senza ricostruire il verdetto. Le label Horizon generiche per i documenti sono proxy su casi italiani, non prova di specificità nazionale o copertura di tutte le patenti.

- **PERSON:** nome e cognome, anche isolati; un solo nome/cognome richiede contesto personale chiaro. Organizzazioni, luoghi e parole ambigue sono negativi.
- **EMAIL_ADDRESS:** indirizzo sintatticamente valido, anche generico/aziendale o con dominio a etichetta singola; nessuna verifica DNS o consegna.
- **PHONE_NUMBER:** qualsiasi paese con prefisso `+`/`00`, default IT senza prefisso; validità dei metadati sull'intero candidato, senza recuperare sottostringhe da numeri malformati.
- **IT_FISCAL_CODE:** canonico con checksum e confini, anche lowercase; omocodia fuori perimetro, non dichiarata amministrativamente invalida.
- **IT_VAT_CODE:** 11 cifre e checksum, prefisso `IT` compatto opzionale; tutte zero negativo. Una sequenza valida separata da `IT ` resta un candidato autonomo.
- **IBAN_CODE:** italiano, 27 caratteri normalizzati, mod97 e spazi ASCII; nessuna verifica di CIN domestico o assegnazione.
- **CREDIT_CARD:** 13–19 cifre ASCII e Luhn, spazi/trattini; nessuna verifica di emittente o assegnazione.
- **IT_IDENTITY_CARD:** seriale CIE attuale di due lettere, cinque cifre e due lettere, con confini di token; nessuna verifica di checksum o assegnazione. Il recognizer Presidio comprende anche formati storici, che il gold non considera positivi per questo scope.
- **IT_DRIVER_LICENSE:** solo la morfologia del sottotipo di duplicati rilasciati dall'Ufficio Centrale Operativo descritta dalla circolare MIT 30039/2011: `U1`, una lettera di serie ammessa, sei cifre e lettera finale di controllo. Non esiste qui un algoritmo verificato per il carattere finale; il gold non attesta validità amministrativa, assegnazione o un formato universale di tutte le patenti correnti.

Il corpus usa lo split `evaluation`. Su indicazione dell’utente prevalgono `cf`/`CF`, `cc`/“conto corrente”, telefoni nazionali compatti e cognomi singoli; forme estese, prefisso internazionale, spazi e un cognome con trattino restano casi limite. Sei cognomi sintetici sono stati accorciati e nove telefoni normalizzati, preservando categorie e numeri nazionali. Questa curatela segue gli input attesi descritti dall’utente, non frequenze produttive misurate. Le varianti policy e le famiglie storiche non aumentano il numero di testi indipendenti; `evaluation` non significa held-out rispetto al training dei modelli.

`expectedEntities` elenca tutte le categorie presenti, non soltanto quella su cui si concentra il caso. Il gold include positivi isolati/in contesto, negativi mirati, checksum e confini, distrattori fuori catalogo, sovrapposizioni e allowlist vuote/complete/parziali/errate. Le varianti correlate condividono la famiglia; non sono campioni indipendenti. La versione dei metadati telefonici usati per annotare il gold è dichiarata nel manifest.

La review indipendente è conclusa prima delle predizioni; lo stato è `independently-reviewed` in `manifest.review` e nelle annotazioni. L’utente ha autorizzato consolidamento e pubblicazione: questo non equivale a una verifica manuale umana di ogni annotazione. Il commit di consolidamento fissa corpus, gold e manifest per il run; non modificarli per adattarli ai risultati. Non esiste un generatore runtime. I dati sono sintetici, ma la non assegnazione non è garantita: non contattare recapiti né tentare transazioni.

## Esecuzione

Dalla root, con Node.js ≥22, dipendenze dei due PoC e asset tokenizer/modello Horizon già disponibili:

```sh
node --test comparison/tests/*.test.mjs
node comparison/functional/run.mjs --validate-only
```

Questi comandi verificano schema, associazioni e calcoli, senza interrogare i detector reali. Alcuni test usano server HTTP finti e il Python locale `poc-spacy/.venv/bin/python` per controlli gold indipendenti. `--validate-only` riporta lo stato della review senza avviare Docker. Non c'è un comando per generare o comporre testi: aggiungere nuovi input richiede inserire una stringa completa in `corpus.json` e le relative annotazioni in `gold.json`, mantenendo gli indici coerenti.

Con il gold consolidato, costruire i servizi ed eseguire il confronto quando autorizzato:

```sh
docker build --pull=false -t free-text-check:presidio-native-evaluation poc-spacy
docker build --pull=false -t free-text-check:horizon-native-evaluation poc-horizon
node comparison/functional/run.mjs \
  --presidio-image free-text-check:presidio-native-evaluation \
  --horizon-image free-text-check:horizon-native-evaluation \
  --output-dir comparison/reports/native-evaluation-run-01
```

La build può scaricare dipendenze. Il runner usa immagini locali già costruite, avvia per image ID con `--pull never`, registra l'immagine effettiva e la versione policy osservata, e richiede che quest'ultima resti coerente nel run. Non modifica il gold e non corregge le risposte attese in base ai risultati.

I container vengono avviati **uno alla volta**, con porta pubblicata su `127.0.0.1`, rete bridge predefinita e modelli configurati offline. Questo binding non prova isolamento egress. Nessuna autenticazione è prevista dall'attuale API locale; non esporla pubblicamente. Readiness, timeout e un piccolo smoke contrattuale precedono i casi misurati; lo smoke non impone una soglia di accuratezza. Il runner rimuove soltanto i propri container anche in caso di errore o interruzione.

## Richieste e risultati

- **Detection:** una richiesta per indice di stringa letterale in `corpus.json`, con allowlist vuota. Più annotazioni in `gold.json` possono riferirsi allo stesso indice solo con gold, split e famiglia coerenti; viene usato il campo della prima annotazione. I collegamenti agli scenari restano nel risultato.
- **Policy:** una richiesta per ogni scenario con la sua allowlist. Si confronta il verdetto reale, senza ricostruirlo dalla detection.

L'API espone solo finding vietate: una risposta accepted con allowlist non permette di misurare tutte le categorie riconosciute. Le due serie di richieste verificano aspetti differenti. Un timeout/503/interruzione è un errore tecnico; una risposta invalida è un errore contrattuale. Entrambi restano fuori da TP/FP/FN/TN. Un errore contrattuale interrompe la raccolta; i casi rimanenti risultano non tentati. Errori di trasporto/503 senza interruzione vengono registrati e la raccolta prosegue, senza retry selettivi.

Ogni nuova directory contiene:

- `results.json` (schema 2): ID, gold categorie/verdetto, allowlist semantica, snapshot del mapping nativo, metadati consentiti e osservazioni **native** per motore/probe; il renderer proietta nello spazio semantico usando lo snapshot;
- `run-manifest.json`: stato, conteggi previsti, immagini e policy osservate, rete effettiva, riferimento Git e stato dirty;
- `summary.json`, `sensitivity.csv`, `verdict.csv`, `report.md`: conteggi e tabelle.

I risultati non contengono testi, span, body HTTP grezzi o motivazioni libere. Lo schema viene verificato prima della scrittura. Il collegamento è **ID → atteso → risposta**, senza hash di corpus/manifest/capability. La directory di output deve essere nuova.

Le tabelle confrontate usano gli stessi casi riusciti su entrambi i motori, separatamente per detection e policy. I conteggi per il singolo motore e la copertura sono disponibili in JSON/CSV. N+/N− e TP/FP/FN/TN accompagnano sensibilità e precisione. Per la policy il positivo è `rejected`: sono riportate accuracy, accettazioni/rifiuti indebiti e relativi denominatori condizionati. L'uguaglianza del set di categorie è misurata **all'interno del catalogo**; eventuali extra label restano diagnostiche. Denominatore zero significa null/N/A.

Per ricalcolare da un risultato salvato senza rileggere il gold corrente né avviare servizi:

```sh
node comparison/functional/run.mjs --render comparison/reports/native-evaluation-run-01/results.json \
  --output-dir comparison/reports/native-evaluation-run-01-render
```

Il render verifica schema e coerenza interna, non autentica il file. Supporta i precedenti bundle schema 1 (baseline a sette categorie e due run storici) con il loro vocabolario e mapping congelati, senza rietichettarli secondo il nuovo gold. Le copie locali storiche sono conservate in `reports/historical/`; la baseline è in `reports/http-gold-2026-11-11-run-01/`.

Il campione `evaluation` è sintetico, revisionato e congelato; conserva i limiti di un campione curato, senza stimare la prevalenza produttiva o garantire assenza dai dati di training. I valori derivano dalle fonti sintetiche dichiarate nel manifest, con curatela manuale di testo, cognomi e formato telefonico. `accepted` non dimostra assenza di dati personali; i test automatici verdi non sono misure di accuratezza dei detector. Il consolidamento non ha eseguito inferenza: il prossimo passo è la preparazione e il run HTTP dei servizi.