# Piano consolidato — servizio PII Node e recognizer italiani

## Goal
Raggiungere correttezza confrontabile con Presidio sui campi del PoC, con runtime Node senza Python: recognizer TypeScript indipendenti e modello ONNX intercambiabile. Presidio resta comparatore, non ground truth. Nessuna parità dimostrata fuori dal corpus verificato.

## Autorità e perimetro
Questo è il piano operativo unico per l'estensione. Sostituisce le istruzioni della bozza `../../../../.hermes/plans/2026-11-09_171000-horizon-recognizer-formati-italiani.md`, conservata come storico. `findings.md` contiene evidenze/limiti, `progress.md` contiene cronologia e verifiche, compreso l'archivio del piano precedente. I due file sono alias preesistenti: non spostarli.
Autorizzata dall'utente l'implementazione su branch dedicato e, successivamente, commit, push del branch e apertura della PR. Download di nuovi modelli e integrazione applicativa richiedono autorizzazione distinta. Le restrizioni precedenti su commit/push sono storiche e superate dalla richiesta di pubblicazione.

## Current Phase
Phase 11 — CF/P.IVA/IBAN IT implementati e verificati localmente e nel container Node-only; review pre-push conclusa con correzioni e pubblicazione del branch autorizzata. Documenti moderni, Rizzo e benchmark comparativo con Presidio restano pendenti. Decisione collisioni approvata: unione conservativa, senza precedenze automatiche.

## Decisioni consolidate
- Prima tranche: patente, carta d'identità e passaporto nei soli formati più recenti documentati, partita IVA e IBAN italiano. Preservare CF esistente; sue estensioni e IBAN non IT da delimitare separatamente. Telefono, date, targhe e CAP differiti alle evidenze; CRYPTO/MEDICAL_LICENSE fuori da questa tranche.
- Forma plausibile sufficiente anche ambigua, senza contesto o checksum obbligatori. Controlli strutturali opzionali non provano autenticità e non diventano gate impliciti.
- Sequenza: validazione richiesta → coda → preflight token di tutti i campi → per campo recognizer TS → inferenza sempre sul testo originale → fusione/policy → risposta atomica.
- Nessun mascheramento del testo, short-circuit dopo match, troncamento o fallback automatico a sole regex. Input invalido: 400; limite tecnico modello/indisponibilità: 503 senza risultati, anche per errore su campo successivo.
- Rizzo candidato da verificare, Horizon baseline conservata. Un solo modello scelto esplicitamente a startup; nessun doppio modello o fallback silenzioso.
- Policy approvata: unione conservativa delle categorie prodotte dai recognizer e dal modello sopra soglia; rifiuto se almeno una categoria non appartiene a allowedEntityTypes del campo. Conservare internamente entrambe le rilevazioni con origine/offset, anche sullo stesso intervallo; nessuna precedenza automatica alle regex e nessuna equivalenza implicita fra categorie generiche e italiane. Deduplicare soltanto i findings pubblici per campo/categoria. Il rischio di FP aggiuntivi è accettato per la baseline; l’unione non corregge i FP del modello. Eventuali specializzazioni future richiedono evidenze, test e decisione separata.
- Solo input sintetici, servizio di prova su 127.0.0.1, nessun testo/span/offset/score in log o risposte pubbliche, nessuna cache di testi/verdetti. `accepted` non certifica assenza di dati personali.

## Architettura proposta
Percorsi relativi a `poc-horizon/` salvo indicazione esplicita; architettura in implementazione incrementale, con adapter compilato e policy completa ancora da verificare.

### Componenti e dipendenze
- `poc-horizon/src/analysis/contracts.mts`: tipi discriminati per candidati rule/model, categoria, origine, intervallo `[start,end)` UTF-16 del testo originale; score solo per modello, stato controllo esplicito `not_checked|passed|failed` per regole, senza proprietà nullable usate come stati impliciti. Nessun testo copiato nei DTO. Costruttori/boundary validation verificano intervalli e label; normalizzazioni devono mantenere una mappa verso il testo originale.
- `src/recognizers/*.mts`: funzioni pure testo → candidati, senza import da Transformers, HTTP o adapter. Registry esplicito e versionato delle regole abilitate; regex limitate e test su input avversari entro i limiti API, niente pattern con backtracking incontrollato. Riutilizzare il CF attuale senza ampliarne implicitamente la copertura.
- `src/models/horizon-adapter.mts`: incapsula caricamento offline/singleton e tokenizer oggi in `detector.mjs`; `prepare(text)` controlla budget senza troncamento e restituisce una richiesta preparata associata al modello; `infer(prepared)` usa il testo originale e converte le uscite in candidati tipizzati. Soglie specifiche del modello, nessun confronto diretto dei punteggi fra modelli. Il riuso degli encoded token è un'ottimizzazione da verificare, non un prerequisito: accettare ritokenizzazione se la pipeline la richiede, preservando lo stesso testo e gli stessi limiti.
- `src/analysis/analyze-fields.mts`: orchestratore unico per API e benchmark, con adapter/registry/decision policy iniettati per test. Dentro la coda esistente: preflight di tutti i campi prima delle detection, poi per campo recognizer → inferenza sempre → candidati combinati. Conservare ordine seriale, coda limitata e un modello caricato per processo. Errore in qualsiasi stadio annulla l'intera risposta; nessun risultato parziale o fallback automatico a sole regex.
- `src/analysis/decision-policy.mts`: applica soglie modello, deduplica e policy sulle categorie; conserva provenienza e offset fino alla risoluzione dei conflitti, poi produce soltanto `fieldId/entityType` ordinati/unici e verdict. Applicare l’unione conservativa approvata, poi sottrarre allowedEntityTypes del singolo campo; verdict rejected se rimane almeno una categoria vietata. Non sopprimere categorie diverse sullo stesso intervallo e non equiparare label native/italiane.
- `src/server.mjs`: resta frontiera HTTP, parsing/limiti/schema e coda. Delega l'analisi al modulo condiviso; stesso contratto 200/400/503, readiness e nessun dato sensibile nei log. `bench/benchmark.mjs` usa il medesimo orchestratore e non ricostruisce la fusione. `categories.mjs` mantiene il catalogo pubblico separato dal mapping modello; eliminare la doppia esecuzione CF quando il registry lo assorbe.
- Futuro `src/models/rizzo-adapter.mts`: stessa interfaccia, mapping e limiti propri. Solo dopo verifica artefatti/licenza e smoke Node offline; selezione esplicita a startup, nessuna inferenza contemporanea Horizon+Rizzo o fallback silenzioso. Aggiornare `modelPolicyVersion` includendo identità/revisione modello, regole e policy.

### Vincoli trasversali (review incorporata)
- **Radice modelli stabile:** risolvere `models/` una sola volta nell'entrypoint/composition root rispetto alla radice del pacchetto e passarla esplicitamente all'adapter; non copiare il `../models/` relativo di `detector.mjs` nel modulo annidato compilato. Nessuna dipendenza dalla directory corrente. Il layout finale conserva `/app/models` in Docker. Verificare startup/readiness con adapter compilato sia localmente da una directory diversa sia nell'immagine finale, con accesso remoto disabilitato.
- **Allowlist per campo:** la decision policy condivisa riceve `allowedEntityTypes` di ciascun campo. Dopo la risoluzione delle categorie filtra quelle consentite, poi costruisce findings e verdict: solo categorie consentite → accepted; combinazione consentite/vietate → findings delle sole vietate. API e benchmark usano la stessa funzione. Testare anche la separazione delle allowlist tra campi e l'assenza di risultati parziali.

### Build proposta
Nuovi moduli `.mts` compilati in `.mjs` sotto `poc-horizon/dist/` con typecheck strict e import ESM espliciti. Mantenere inizialmente gli entrypoint `.mjs`, che importano output compilato. Definire script build/test/start/bench affinché nessuno usi output vecchio; escludere dist dai sorgenti versionati. Docker multi-stage: dipendenze build nel builder, artefatti compilati e sole dipendenze runtime nell'immagine finale; modelli prefetchati e verificati, nessun download a richiesta. Verificare runtime interamente Node anche nel container; nessuna migrazione globale del repository a TS.

### Slice e gate di accettazione
1. **Contratti e build:** test artefatto compilato e import dagli entrypoint; decidere mappatura offset Transformers sul testo originale con casi emoji/accenti. Nessuna variazione di policy o modello.
2. **Orchestratore con regola CF esistente:** separare preflight, spostare la regola prima dell'inferenza e mantenere la semantica storica del solo CF durante il refactor. Test spy per ordine e conteggio, modello chiamato dopo match, nessuna detection se un campo è fuori budget, errore secondo campo senza parziali, coda invariata. Testare la policy approvata anche sulle nuove categorie: match di sola regex, categorie discordanti sullo stesso intervallo, entrambe consentite, una sola consentita e allowlist diverse tra campi.
3. **Recognizer italiani:** audit delle fonti e fixture prima dei pattern; patente, carta moderna, passaporto recente, P.IVA, IBAN IT in slice separate. Positivi sintetici senza contesto, negativi fuori forma, forme ambigue, confini Unicode, separatori ammessi e checksum non obbligatori. Estensioni CF/IBAN non IT separate. Aggiornare catalogo/API/test/matrice/versione solo per categorie realmente attivate.
4. **Challenger Rizzo:** verificare licenza e provenienza, revisioni/hash, tokenizer/label/offset, carico offline e risorse nel container. Nessun presupposto che DOCID distingua i documenti italiani; riclassificazione solo con regole documentate. Conservare Horizon come baseline riproducibile.
5. **Confronto e review:** stesso corpus heldout e policy esplicita, diagnostiche per origine e errori tecnici esclusi dalle metriche di detection ma conteggiati; report senza testi/span/score. Verificare HTTP, benchmark, build e smoke reale del modello scelto; review indipendente per slice. Parità con Presidio da misurare, non dichiarare anticipatamente.


## Phases
### Phase 1: Ricognizione e PoC storico (fasi precedenti 1–7)
**Status:** complete
Implementazioni e verifiche storiche archiviate in progress/findings; non costituiscono nuove esecuzioni. Conservare in particolare l'eccezione alla quarta review del fix media type.

### Phase 8: Integrazione applicativa e criteri produttivi
**Status:** pending
Categorie/policy stakeholder, soglie di accettazione, budget risorse e prove di durata rappresentative restano da concordare. Nessuna integrazione autorizzata; le prove finite non stabiliscono stabilità indefinita o SLA.

### Phase 9: Indagine latenza storica
**Status:** complete
Threading ONNX e batching esplorati, non attivati nel codice in base a queste sole misure.

### Phase 10: Confronto e documentazione storici
**Status:** complete
Risultati storici e pubblicazione documentale distinti dall'estensione corrente; dettagli nell'archivio.

### Phase 11: Recognizer TS e modello intercambiabile
**Status:** in_progress
- [x] Decisioni di architettura e perimetro raccolte.
- [x] Review architetturale indipendente incorporata: radice modelli stabile e allowlist per campo.
- [x] Consolidamento finale del piano revisionato indipendentemente: PASS; implementazione successivamente autorizzata e avviata.
- [x] Slice 1 — contratti e build compilata; smoke Docker offline e import runtime verificati.
- [x] Slice 2 — orchestratore con CF esistente e preflight; test e review pre-push superati.
- [x] Gate utente — unione conservativa approvata; test di co-emissione/allowlist e conservazione interna di origine/offset superati.
- [~] Slice 3 — recognizer italiani P.IVA e IBAN IT implementati con test sintetici; documenti e fonti/fixture ufficiali pendenti.
- [ ] Slice 4 — verifica e prova Rizzo.
- [ ] Slice 5 — confronto e review del codice.

## Protocollo di verifica
Presidio fissato, Horizon baseline, Horizon+regole e Rizzo+stesse regole: corpus sintetico versionato, etichette indipendenti, sviluppo/heldout distinti e diagnostiche solo-regole/solo-modello. Correggere le fixture illustrative prima di usarle come prova dei formati. Misurare FP/FN per categoria supportata e correttezza del verdetto; unsupported e errori tecnici espliciti, non occultati nei denominatori. Due probe distinguono detection e allowlist. Risorse comparabili 2 CPU, 4 GiB senza swap; latenza, RAM e versioni registrate senza dati sensibili. Non inferire parità dai soli 39 campioni storici o dagli score pubblicati dagli autori.

## Gate ancora aperti
1. Fusione decisa: unione conservativa; nessun gate decisionale residuo sulla baseline. Restano da implementare e verificare i test di co-emissione/allowlist.
2. Esatti formati recenti e loro fonti, confini/separatori e fixture: verifica prima dei pattern.
3. Rizzo: licenza/provenienza, revisioni/hash, compatibilità Node/ONNX, risorse e correttezza; nessuna sostituzione automatica.
4. Soglie quantitative di successo e integrazione: da concordare dopo una baseline affidabile.
