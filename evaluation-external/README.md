# Pilot esterno: presenza per campo e policy

`gold.json` → due POST distinti a `/v1/analyze` per caso e motore →
`results.json`, `detection.csv`, `verdict.csv`, `coverage.csv`, `observations.csv`, `report.md`.
Python è solo harness: non importa detector, non avvia container, non modifica servizi.
**Il completamento di questo harness non ha eseguito inferenza sul gold.** I test HTTP
usano server finti su loopback e fixture separate, non i detector. Il primo run dei
servizi reali è lasciato al parent. Gold e testi non sono stati modificati in questa ripresa.

## Esecuzione

Dalla root del worktree, preflight senza rete:

```sh
rtk proxy python3 evaluation-external/runner.py --validate-only
rtk proxy uv run --with pyarrow==23.0.1 python evaluation-external/prepare_gold.py --check
rtk proxy uv run --with pyarrow==23.0.1 python -m unittest discover -s evaluation-external/tests -v
```

`pyarrow` serve soltanto alla preparazione/verifica dei parquet; il runner usa la
standard library. I due file `.downloads/rizzo.parquet` e `.downloads/gretel.parquet`
sono prerequisiti del controllo offline, non vengono scaricati dal runner. Non usare
la modalità scrittura di `prepare_gold.py` dopo avere osservato predizioni.

Quando i servizi scelti dal parent sono pronti, valorizzare le due URL loopback
con le porte effettive; non puntare a provider di inferenza esterni:

```sh
rtk proxy python3 evaluation-external/runner.py \
  --gold evaluation-external/gold.json \
  --baseline-capabilities evaluation-external/baseline-capabilities.json \
  --new-url "$NODE_URL" --baseline-url "$PRESIDIO_URL" \
  --timeout 60 --output evaluation-external/results/first-http
```

Le URL sono basi senza `/v1/analyze`. Il runner non verifica l'identità delle immagini
né la readiness: il parent deve mantenere la stessa baseline Presidio main.
La directory di output deve essere nuova; un percorso esistente fallisce prima
che parta qualsiasi POST. Nessun retry selettivo e nessun tuning sulle predizioni.

Render offline, senza rileggere il gold corrente e senza rete:

```sh
rtk proxy python3 evaluation-external/runner.py \
  --render evaluation-external/results/first-http/results.json \
  --output evaluation-external/results/first-http-rendered
```

Exit code: `0` raccolta completa/render completo/preflight; `2` raccolta o bundle
incompleto (oppure errore di argomenti argparse); `3` input invalido o errore I/O.
Timeout, HTTP 400/503 e trasporto sono technical failures; risposte invalide/versione
errata sono contract failures. Non contribuiscono a TP/FP/FN/TN. Un Ctrl-C durante
la richiesta registra `INTERRUPTED`, lascia il resto `unattempted` e salva un receipt
incompleto. Hard kill, crash di processo o disco indisponibile non garantiscono un
receipt; un errore di scrittura può lasciare file parziali. Non è un sistema di resume.

## Contratti e misura

- **Detection:** deny-all esplicito in tutti i campi, una richiesta per caso e motore.
  Misura la presenza della categoria nel campo, non span, conteggio delle entità o
  validità amministrativa. Duplicati semantici sono deduplicati.
- **Policy:** altra richiesta HTTP con le allowlist del caso; nessuna simulazione
  del verdetto a partire dalla detection. Una categoria vietata in qualsiasi campo
  determina il rifiuto atteso. L'allowlist di un campo non vale negli altri.
- API Node: `{fields:[{fieldId,text,allowedCategories}]}` →
  `{verdict,findings:[{fieldId,category}]}`. Il runner passa sempre la lista, anche vuota.
- API baseline main: `{fields:[{fieldId,text,allowedEntityTypes}]}` →
  `{verdict,modelPolicyVersion,findings:[{fieldId,entityType}]}`.
  `allowedEntityTypes` è required e contiene solo label native effettivamente supportate.
- `baseline-capabilities.json` registra **evidenza runtime fornita dal parent**,
  ottenuta tramite `docker run`, policy `it-spacy-sm-3.8.0-poc1`: 18 label native,
  tutte le 9 categorie del confronto disponibili, comprese `IT_IDENTITY_CARD` e
  `IT_DRIVER_LICENSE`. Mapping identity esplicito, nessuna alias inventata.
  **Disponibilità del registry non significa detection efficace.** In caso di snapshot
  diverso validato, label non disponibili non sono inviate nelle allowlist e sono
  dichiarate nel report; non sono eliminate dal gold o dallo scoring.
- Gli extra della baseline, per esempio `LOCATION`, restano negli observations e
  continuano a determinare il **raw verdict originale**. Non vengono consentiti
  artificialmente né eliminati prima del confronto dei verdetti. La tabella raw
  verdict confronta una baseline con catalogo più ampio contro il gold a 9 categorie:
  **non è una comparazione equal-policy**. Nessuna tabella normalizzata è prodotta.
- Ogni coppia campo/categoria `unknown` è esclusa dalla detection, mai TN. Un verdetto
  è ignoto solo se non c'è una categoria sicuramente vietata ma esiste un unknown
  non consentito. In questo pilot tutti i casi con unknown hanno altri positivi
  vietati: nessun verdetto atteso rimane ignoto.
- Le matrici usano successi **appaiati fra motori**, separatamente per detection e
  policy e per sorgente. La coverage mostra anche i successi propri di ogni motore.
  Fallire la policy non cancella una detection riuscita. Denominatore zero = `null`
  in JSON, cella vuota in CSV, `N/A` in Markdown.
- Positivo del verdetto = `rejected`. Sensibilità = TP/(TP+FN), precisione = TP/(TP+FP),
  accuracy = (TP+TN)/N, balanced accuracy = media di sensibilità e specificità.
  False acceptance = FN/(TP+FN); false rejection = FP/(FP+TN). Questi ultimi nomi
  riguardano il verdetto, non una garanzia di assenza di dati personali.
- Risultati sanitizzati: solo ID, categorie, allowlist, esiti/codici e snapshot
  capabilities. Niente testi, span, valori delle entità o body d'errore. Il render
  valida schema, completezza delle osservazioni e ricalcolo delle metriche; non
  certifica autenticità contro modifiche coordinate del bundle.

## Inventario verificato prima delle predizioni

| Sorgente | Casi HTTP per probe/motore | Testi distinti |
| --- | ---: | ---: |
| Rizzo `clean/val` | 10 | 10 |
| Gretel `Italian_test` | 18 | 18 |
| Mirati sintetici letterali | 25 | 26 |
| Totale | 53 | 54 |

Due probe × due motori: **212 richieste pianificate**. Nessun testo viene troncato.
Massimo osservato: 2 campi/caso, 50 parole whitespace/campo, 1.080 caratteri/byte UTF-8.
Preflight impone massimo 10 campi, 50 unità separate da whitespace, 2.000 caratteri,
8.000 byte per campo. La conta whitespace corrisponde al contratto Node sui testi
selezionati: **CSV/XML possono contenere molte parole linguistiche dentro una sola
unità whitespace**. Il limite non è un limite di token del modello; il parent ha
riportato separatamente smoke Node con coda email e overflow esplicito, non questo gold.

5 campi hanno allowlist non vuote: consentita, sbagliata, parziale, completa e
scoping multifield. Policy attesa: **41 rejected, 12 accepted, 0 unknown**.
Dieci testi non contengono positivi nel catalogo: cinque Gretel e cinque mirati;
gli altri due accepted derivano da eccezioni consentite.

| Categoria | Positivi | Negativi noti | Unknown esclusi | Famiglie positive dichiarate |
| --- | ---: | ---: | ---: | ---: |
| PERSON | 28 | 26 | 0 | 11 |
| EMAIL_ADDRESS | 12 | 42 | 0 | 7 |
| PHONE_NUMBER | 10 | 44 | 0 | 4 |
| IT_FISCAL_CODE | 8 | 46 | 0 | 2 |
| IT_VAT_CODE | 2 | 52 | 0 | 1 |
| IBAN_CODE | 4 | 50 | 0 | 3 |
| CREDIT_CARD | 10 | 44 | 0 | 4 |
| IT_IDENTITY_CARD | 2 | 46 | 6 | 2 |
| IT_DRIVER_LICENSE | 2 | 45 | 7 | 2 |

`gold.json` conserva revisione, hash del parquet, riga originale, split, label e span
upstream. Revisioni congelate: Rizzo `50163bcda973efe818004d053cfa159f0927663f`;
Gretel `7b844d16738527a04264f50214cb426a4cea0897`. Parquet locali: rispettivamente
29.297 e 448 righe. Il test indipendente confronta byte del testo e annotazioni
upstream con le righe originali, oltre al `prepare_gold.py --check` deterministico.
Il parent ha riletto le card alle revisioni fissate: licenze dichiarate MIT (Rizzo) e Apache-2.0 (Gretel), con provenienza sintetica dichiarata. Questa verifica documentale non costituisce consulenza legale né certificazione di non coincidenza con dati reali.

## Review indipendente pre-inferenza

PASS della review indipendente `deleg_1f14a5a6`: letti integralmente 54/54 testi, verificate tutte le 486 decisioni campo/categoria, 13 unknown e le allowlist; nessun blocker/high/medium. Runner/scoring/contratti verificati e 20/20 test passati. Nessuna inferenza e nessuna modifica al gold durante la review. Questa attestazione si aggiunge alla revisione dell’implementatore sottostante; il metadata storico `independentReview: false` viene preservato per mantenere il gold byte-identico alla preparazione offline.

## Registro completo della revisione manuale

L'agente implementatore ha letto **tutti i 54 testi completi**, non solo gli span,
prima di qualsiasi predizione del gold: 486 decisioni campo/categoria, 13 unknown.
La tabella seguente è il registro esaustivo; nessuna PII è ripetuta nel registro.
È revisione semantica dell'implementatore, **non approvazione umana né review
indipendente** (`independentReview: false` rimane corretto nel gold).

Legenda: P=PERSON, E=EMAIL_ADDRESS, T=PHONE_NUMBER, F=IT_FISCAL_CODE,
V=IT_VAT_CODE, I=IBAN_CODE, C=CREDIT_CARD, D=IT_IDENTITY_CARD,
L=IT_DRIVER_LICENSE. `—` = nessuna. Tutte le categorie non positive né unknown
sono state rilette come negative nel catalogo; non si assume completezza degli span.

| Caso | Campo | Positivi rivisti | Unknown | Esito revisione |
| --- | --- | --- | --- | --- |
| `rizzo-2266` | `description` | P E T D L | — | completo |
| `rizzo-2335` | `description` | P | — | completo |
| `rizzo-14989` | `description` | P E T C | — | completo |
| `rizzo-15085` | `description` | P E T F C | D L | completo |
| `rizzo-15127` | `description` | P E T F C | D L | completo |
| `rizzo-15224` | `description` | P E T F C | D L | completo |
| `rizzo-15261` | `description` | P E T F C | D L | completo |
| `rizzo-15265` | `description` | P T F | D L | completo |
| `rizzo-15285` | `description` | P E T F C | D L | completo |
| `rizzo-26377` | `description` | P | — | completo |
| `gretel-38` | `description` | P C | — | completo |
| `gretel-50` | `description` | P | — | completo |
| `gretel-60` | `description` | — | — | completo |
| `gretel-96` | `description` | P | L | completo |
| `gretel-114` | `description` | — | — | completo |
| `gretel-128` | `description` | — | — | completo |
| `gretel-146` | `description` | P E | — | completo |
| `gretel-256` | `description` | P | — | completo |
| `gretel-282` | `description` | P | — | completo |
| `gretel-311` | `description` | — | — | completo |
| `gretel-313` | `description` | — | — | completo |
| `gretel-321` | `description` | P | — | completo |
| `gretel-328` | `description` | P I | — | completo |
| `gretel-364` | `description` | P | — | completo |
| `gretel-382` | `description` | P | — | completo |
| `gretel-421` | `description` | P | — | completo |
| `gretel-431` | `description` | P | — | completo |
| `gretel-443` | `description` | P | — | completo |
| `targeted-00` | `description` | P | — | completo |
| `targeted-01` | `description` | E | — | completo |
| `targeted-02` | `description` | T | — | completo |
| `targeted-03` | `description` | F | — | completo |
| `targeted-04` | `description` | V | — | completo |
| `targeted-05` | `description` | I | — | completo |
| `targeted-06` | `description` | C | — | completo |
| `targeted-07` | `description` | D | — | completo |
| `targeted-08` | `description` | L | — | completo |
| `targeted-09` | `description` | F | — | completo |
| `targeted-10` | `description` | V | — | completo |
| `targeted-11` | `description` | I | — | completo |
| `targeted-12` | `description` | C | — | completo |
| `targeted-13` | `description` | — | — | completo |
| `targeted-14` | `description` | — | — | completo |
| `targeted-15` | `description` | — | — | completo |
| `targeted-16` | `description` | — | — | completo |
| `targeted-17` | `description` | — | — | completo |
| `targeted-18` | `description` | P | — | completo |
| `targeted-19` | `description` | E | — | completo |
| `targeted-20` | `description` | P E | — | completo |
| `targeted-21` | `description` | P E | — | completo |
| `targeted-22` | `description` | I | — | completo |
| `targeted-23` | `description` | C | — | completo |
| `targeted-24` | `contactName` | P | — | completo |
| `targeted-24` | `eserviceDescription` | T | — | completo |

Decisioni applicate alla lettura completa:

- Sei `ID_DOC` Rizzo non identificano in modo certo carta d'identità o patente
  italiana: entrambe unknown. Non trasformare un identificativo generico in un TN.
  La patente estera/non attribuibile all'Italia in `gretel-96` resta unknown per L.
  Un passaporto esplicito è invece fuori catalogo, non una carta d'identità.
- Date, età, sesso, indirizzi, organizzazioni, password e IP sono fuori catalogo;
  i loro eventuali riconoscimenti baseline restano comunque negli extra/raw verdict.
  Nomi nelle colonne persona sono positivi anche quando gli span upstream sono
  incompleti; eponimi di strade e local-part email non aggiungono automaticamente P.
- Telefoni mascherati Rizzo sono ancora riconoscibili come informazione telefonica.
  Etichette senza valore, piccoli conteggi e codici interni dei mirati negativi
  non costituiscono le categorie personali testate.
- Identificativi riconoscibili con checksum errato restano **positivi**, anche per
  il modello Rizzo: la policy non è un validatore amministrativo. Test indipendenti
  verificano le quattro coppie valide/errate CF, IVA, IBAN e carta nei mirati
  `03–06` / `09–12`. I CF e le carte dei dieci record Rizzo selezionati passano
  i controlli: non si rivendica copertura checksum-errato esterna che qui non c'è.
- Incoerenze grammaticali/anagrafiche e testi strutturati degli esterni sono
  preservati, non corretti o troncati per favorire un detector.

## Verifica e limiti

Verifica finale dell'harness: **20 test passati** con il comando completo sopra;
`prepare_gold.py --check` conferma che il gold coincide con la preparazione offline.

TDD osservato: CLI prima assente, preflight/validazione mancanti, gestione Ctrl-C
mancante, chiavi JSON duplicate accettate, preflight CLI e registro review mancanti;
poi verifiche GREEN. La suite copre CLI subprocess + HTTP loopback reale, due probe,
full/partial/wrong allowlist e scoping multifield, baseline extras/raw verdict,
unknown esclusi, matrici asimmetriche, HTTP 400/503, timeout, JSON invalido/duplicato,
version mismatch, interruzione, write failure, output esistente, render byte-identico
senza HTTP e manipolazioni strutturali del bundle. Sono prove dell'harness, **non
risultati di accuratezza dei detector**. Il parent deve eseguire i POST reali e
ricontare le matrici dagli observations salvati prima di interpretare le percentuali.

Pilot deliberatamente piccolo e selezionato: Rizzo ha 7 thread correlati su 10;
Gretel ha 11 CSV su 18, quattro fogli cambi, due EDI e un FpML, spesso con nomi
stranieri. Le quattro coppie checksum condividono valori e non sono campioni
indipendenti. Le famiglie sono raggruppamenti dichiarati, non una prova statistica
di indipendenza. Copertura IVA e documenti italiani minima. Rizzo **non è dichiarato
unseen** rispetto al modello; anche i mirati impiegano alcuni identificativi di
esempio noti. Non si misura rappresentatività di produzione, non si decreta un
vincitore da accuracy aggregata, non si misura performance e non si certifica
l'assenza di dati personali da un semplice `accepted`.
