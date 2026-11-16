# Rivalutazione del servizio HTTP di controllo testi

**PLAN_ID:** `functional-detector-comparison`
**Stato:** requisito congelato; implementazione funzionale ripresa sul branch `refactor/horizon-typescript`.

## Ordine vincolante delle attività — correzione dell'utente
Prima si completa il requisito funzionale e si consegna il confronto descrittivo. Performance, latenza, concorrenza, consumo e crescita della memoria del container saranno affrontati **come ultimissima attività**, dopo il lavoro funzionale. NON tenerne conto nelle scelte implementative, nei gate o nei criteri di completamento della fase funzionale; nessun benchmark prestazionale, dimensionamento o ottimizzazione anticipata. Resta vincolante da subito il runtime Node, con detection nel processo Node e container finale senza Python. Restano funzionali i limiti di 10 campi e 50 parole per campo.
L'obiettivo di latenza concordato e il tema memoria sono conservati esclusivamente per la fase finale e non bloccano implementazione o consegna funzionale.

## Goal fissato dall'utente
Realizzare un servizio HTTP su Node, distribuito in container, con contratto API semplice. Il chiamante riceve soltanto il verdetto `accepted` oppure `rejected` e, per le categorie non ammesse presenti nei testi in input, `fieldId` e nome della categoria. Nessun testo estratto, valore sensibile, span, score, spiegazione o dettaglio del motore nella risposta di business.

Il container deve avere una crescita della memoria contenuta e misurabile: evitare il comportamento di crescita attribuito dall'utente alla cache di Presidio. Budget, durata, carico e criterio di stabilità saranno definiti esclusivamente nella fase finale, come richiesto dall’utente; non condizionano il congelamento né l’implementazione funzionale e non vanno inventati.

La consegna funzionale è una tabella comparativa di sensibilità e correttezza, con FP, TP, FN e TN, tra il servizio ottenuto e Presidio; eventuale terza versione da decidere. Definire unità di conteggio, positività, formule e criteri di successo prima dei test. Errori tecnici distinti dalle classificazioni.

## Congelamento del requisito
Il goal sopra è vincolante. I dettagli iniziali vengono concordati con al massimo 10 domande, una alla volta. A conclusione: sintesi, unica review avversariale indipendente e approvazione esplicita dell'utente. Il requisito approvato diventa intoccabile fino al suo raggiungimento: nessun abbassamento di soglie, esclusione opportunistica di casi o cambio di semantica per dichiarare successo. Eventuali impossibilità vanno riportate come blocchi, non risolte cambiando il requisito.

## Current Phase
### Phase 5: Refactoring architetturale dei PoC verso la forma Interop
**Status:** complete
Refactoring autorizzato sul branch `refactor/horizon-typescript`. Per il repository PoC standalone: sostituire il dispatch manuale con un router framework senza parser JSON implicito; mantenere stream/body reader rigoroso, contratto HTTP e admission; rendere `index.ts` un composition root sottile tramite lifecycle server dedicato; validare la config fail-fast; separare l'interpretazione dell'output Horizon dal catalogo domain; mantenere tipi validati nel dominio Rizzo; rendere esplicita e leggibile l'orchestrazione sequenziale. Autenticazione service-to-service, middleware `pagopa-interop-commons` e API client generato restano fuori dal repository standalone e richiedono il package finale nel monorepo. Non introdurre un timeout fittizio con `Promise.race`: la cancellabilità reale dell'inferenza resta una decisione separata.

Gate: RED/GREEN mirati per routing/config/readiness/layering, suite complete di entrambi i PoC, `pnpm check`, `git diff --check`, smoke HTTP e review avversariale del diff. Nessun benchmark prestazionale o modifica della detection.

### Phase 1: Intervista e congelamento del requisito
**Status:** complete
Domanda 1/10 acquisita: servizio e detection eseguiti dal processo Node; il container finale non deve avere dipendenze Python. Le domande successive vanno presentate tramite interfaccia interattiva, una alla volta. Q2 confermata: persone, email, telefoni, CF, partita IVA, IBAN, carte di pagamento, CIE e patente italiana sono obbligatorie. Q3: anche identificativi riconoscibili con checksum errato devono essere rilevati; se categoria vietata causano rejected. La validità del checksum non è un filtro di esclusione. Non equivale ad accettare qualsiasi stringa arbitraria come identificativo. Q4: input lista di campi con fieldId, text e allowedCategories opzionale per campo; omessa/vuota vieta tutte le categorie. Rejected globale se almeno un campo viola la policy; tutte le coppie fieldId/categoria vietata, deduplicate. Q5: testi italiani, incluse persone con nomi stranieri; telefoni, CF, P.IVA, CIE e patente italiani; email, IBAN e carte internazionali. Patente non limitata implicitamente a UCO; inventario dei formati da esplicitare prima del congelamento. Q6: massimo 10 campi per richiesta e 50 parole per campo; latenza sotto 500 ms nel 90% delle richieste dopo warm-up. Concorrenza da valutare, non fissata. Le proposte di 2000 caratteri, 4 richieste, 2 secondi/95% e 2 vCPU NON sono approvate. Definire conteggio parole e limite byte di sicurezza, hardware e carico per rendere verificabile la latenza. Q7: budget e criteri quantitativi di memoria rimandati esplicitamente dall’utente a un secondo momento. Nessuna approvazione di 1 GiB, 2 ore o 5%. Resta vincolante l’obiettivo qualitativo di contenere la crescita; non dichiararne il raggiungimento finché non saranno concordati i criteri. Concorrenza e memoria sono decisioni differite autorizzate, non soglie modificabili a posteriori per promuovere risultati. Q8: errori HTTP separati, senza verdetto e senza dettagli sensibili. 4xx per input invalido/limiti, 5xx per impossibilità tecnica; mai accepted su analisi incompleta. Errori tecnici contati separatamente, non in TP/TN/FP/FN. Q9: benchmark esterno italiano più casi mirati per requisiti scoperti; stesso gold sintetico/testi/policy per nuovo servizio e Presidio, terzo comparatore attuale opzionale. Adattamento esplicito al limite 50 parole e alla semantica concordata; gold congelato prima delle predizioni. Matrice per coppia campo-categoria (presenza vietata positiva) e matrice per verdetto complessivo (rejected atteso positivo). Sensibilità TP/(TP+FN); correttezza (TP+TN)/(TP+TN+FP+FN). Nessun requisito di output span. Q10: solo confronto descrittivo, nessuna soglia funzionale vincolante. Intervista conclusa, 10/10; nessun obbligo di superare o uguagliare Presidio.

Questioni da risolvere entro il budget: runtime; categorie/lingua e positività degli identificativi; policy delle categorie ammesse; struttura input e aggregazione output; limiti input/carico; errori tecnici; budget/stabilità memoria; benchmark/dataset e comparatori; unità delle metriche e soglie funzionali. Accorpare solo questioni strettamente collegate. I dettagli ricavabili dal codice non sono domande all'utente; il codice attuale non impone i requisiti nuovi.

### Phase 2: Rivalutazione tecnica sul requisito congelato
**Status:** complete
La prosecuzione autorizzata dall'utente adotta l'implementazione già avviata nel branch: i PoC TypeScript esistenti Rizzo e Horizon condividono il contratto HTTP e l'harness, invece di creare il nuovo `poc-node-pii/` ipotizzato nei findings. La proposta precedente resta evidenza storica, non roadmap operativa.

### Phase 3: Realizzazione e verifica funzionale
**Status:** complete
Workspace pnpm, contratto comune e container Node-only verificati. Horizon rileva identificativi morfologicamente riconoscibili con checksum errato e IBAN internazionali; i prefissi di candidati IBAN oltre 34 caratteri, anche raggruppati con spazi, sono esclusi. Il confronto HTTP sul gold congelato è stato rieseguito: 546/546 richieste riuscite, senza errori tecnici o contrattuali, con report descrittivo FP/TP/FN/TN in `tests/evaluation/results/horizon-typescript-2026-11-16/`. Nessun criterio prestazionale o di memoria ha condizionato questa fase.

### Phase 4: Performance e memoria — ultimissima attività
**Status:** pending
Solo dopo il completamento funzionale: definire carico, concorrenza e criteri di memoria; misurare latenza e memoria del container, poi valutare eventuali ottimizzazioni senza alterare il requisito funzionale. Il target sotto 500 ms nel 90% dopo warm-up si applica qui, non alla fase funzionale.

## Perimetro corrente
Implementazione e verifica funzionale locale completate sul branch `refactor/horizon-typescript`; refactoring architetturale Phase 5 autorizzato sullo stesso branch. Niente commit, push o pubblicazione senza richiesta esplicita. Il report del 12 novembre resta un artefatto storico; il run corrente è quello del 16 novembre. Performance e memoria restano escluse fino alla Phase 4.
