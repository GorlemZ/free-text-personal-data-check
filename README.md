# Controllo dei dati personali nei campi liberi

Stato al 16 novembre 2026.

## Stato attuale

Tre prototipi (PoC) confrontano il riconoscimento di dati personali nei testi liberi. Condividono il contratto business e le categorie considerate: per ogni campo si indicano le categorie consentite; le altre categorie rilevate causano il rifiuto della richiesta. I criteri di riconoscimento restano specifici di ogni motore.

| PoC      | Come riconosce i dati                                                          |
| -------- | ------------------------------------------------------------------------------ |
| Rizzo    | Modello per i dati personali, con regole integrative per categorie non coperte |
| Horizon  | Modello più compatto, con regole integrative per categorie non coperte         |
| Presidio | Libreria di riconoscimento con un modello per la lingua italiana               |

L'elaborazione avviene localmente. Rizzo e Horizon hanno sorgenti TypeScript compilati in JavaScript e usano Transformers.js; Presidio usa Python. I due servizi Node condividono `@pagopa/detector-http`, il package infrastrutturale che monta routing Express senza parser JSON implicito, valida la porta e gestisce listen/segnali/shutdown; body reader, service, adapter e dominio restano nei rispettivi PoC.

Il refactor di Rizzo e Horizon usa l'inferenza come fonte primaria, senza veto basati sugli offset o controlli strutturali aggiuntivi sulle predizioni. Le regole integrano soltanto categorie non coperte dal modello. Il budget di token e il limite delle analisi contemporanee sono configurabili; le richieste eccedenti la capacità vengono respinte senza attesa. Il parsing JSON standard conserva l'ultimo valore delle chiavi duplicate; gli identificatori di campo duplicati restano vietati.

## Valutazione funzionale aggiornata

Il **16 novembre 2026** abbiamo valutato Rizzo e Horizon al commit **`5a497a9067635f2cb859bdb7ef878792e9cedcc3`**, con inferenza reale in container Docker e richieste HTTP. Gold, annotazioni e soglie sono rimasti invariati.

Il campione esteso comprende **151 scenari, 152 campi e 142 testi distinti**. Sono state completate **604 richieste su 604**, senza errori tecnici o contrattuali e senza retry selettivi: una richiesta di detection senza categorie consentite e una richiesta con la policy annotata per ogni scenario e motore. Presidio non è stato rieseguito in questa valutazione.

### Correttezza dei verdetti

Il gold prevede **98 rifiuti e 53 accettazioni**. La tabella usa i verdetti HTTP effettivi delle richieste policy.

| PoC     | Decisioni corrette | Accettate per errore (su 98) | Rifiutate per errore (su 53) |
| ------- | -----------------: | ---------------------------: | ---------------------------: |
| Rizzo   |             89,40% |                    4 — 4,08% |                  12 — 22,64% |
| Horizon |             90,07% |                    9 — 9,18% |                   6 — 11,32% |

Rizzo lascia passare meno scenari da rifiutare, ma produce più falsi rifiuti. Horizon restituisce l'insieme esatto delle categorie note in **124/152 campi**, contro **110/152** di Rizzo, nel catalogo valutato e ignorando le categorie annotate come ambigue. Un rifiuto corretto può essere causato anche da una categoria sbagliata: la correttezza del verdetto non sostituisce quella della detection.

### Sensibilità e precisione per categoria

La **sensibilità** misura quanti positivi attesi vengono individuati; la **precisione** quante segnalazioni sono corrette. L'unità di misura è la presenza della categoria nel campo, non il numero di entità o l'accuratezza degli span. Le **13 coppie campo/categoria annotate come ambigue** sono escluse dai conteggi detection, senza essere considerate errori; la policy è decidibile per tutti gli scenari.

| Categoria                 | Positivi attesi | Rizzo sensibilità | Rizzo precisione | Horizon sensibilità | Horizon precisione |
| ------------------------- | --------------: | ----------------: | ---------------: | ------------------: | -----------------: |
| Persona                   |              63 |            96,83% |           96,83% |              96,83% |             98,39% |
| Email                     |              24 |              100% |              96% |                100% |                96% |
| Telefono                  |              20 |               80% |              80% |                100% |                80% |
| Codice fiscale            |              17 |              100% |              85% |              88,24% |               100% |
| Partita IVA               |              10 |               40% |           44,44% |                 70% |               100% |
| IBAN                      |               9 |              100% |           31,03% |              44,44% |               100% |
| Carta di credito          |              14 |              100% |           73,68% |                100% |             63,64% |
| Carta d'identità italiana |               7 |            85,71% |             100% |              85,71% |               100% |
| Patente italiana          |               8 |            62,50% |             100% |              62,50% |               100% |

I principali limiti osservati sono:

- **IBAN:** Rizzo trova tutti i 9 positivi ma aggiunge 20 falsi positivi; Horizon ne trova 4 senza falsi positivi.
- **Partita IVA:** Rizzo trova 4 positivi su 10 con 5 falsi positivi; Horizon ne trova 7 senza falsi positivi.
- **Patenti:** entrambi trovano 5 positivi su 8.

Non emerge un vincitore automatico: la scelta dipende dal compromesso fra dati non riconosciuti e blocchi ingiustificati.

### Limiti e verifica del run

Il campione è di sviluppo, **non held-out**, e contiene scenari correlati e testi riutilizzati. La detection viene ripetuta per scenario; le percentuali non dimostrano generalizzazione o adeguatezza alla produzione. La geografia prevista dal gold per telefoni e documenti è italiana: il confronto misura il comportamento delle pipeline, comprese eventuali segnalazioni più ampie del modello.

Un riconto indipendente delle osservazioni ha confermato matrici, denominatori e CSV. I risultati dettagliati e il gold esteso restano locali; questa modifica pubblica soltanto la sintesi, senza testi del corpus. Il pilot pubblicato sotto `tests/evaluation/` contiene invece 91 scenari e risultati storici: non va confuso con il run esteso qui descritto.

Le immagini sono state costruite dai sorgenti del commit indicato. Per Horizon il Dockerfile di staging ometteva soltanto il comando prefetch `--verify-only`: il run verifica quella build derivata, **non il Dockerfile originale end-to-end**. Le build delle dipendenze hanno usato la rete; l'inferenza ha usato asset locali, senza download dei pesi. Non viene dichiarato isolamento di rete del container. I container del run sono stati rimossi.

## Memoria — misure storiche, non rieseguite dopo il refactor

Le misure seguenti precedono le nuove versioni e **non ne certificano il consumo**. Rizzo e Horizon avevano completato una prova con 4 GB disponibili e 30 richieste ciascuno; Presidio era stato misurato con un carico diverso.

| PoC      | Massimo di RAM osservato nella prova storica | Esito storico                                                         |
| -------- | -------------------------------------------: | --------------------------------------------------------------------- |
| Rizzo    |                                Circa 4,00 GB | Vicino al limite; nella prova a 2 GB l'avvio non era stato completato |
| Horizon  |                                Circa 2,36 GB | Test a 4 GB completato                                                |
| Presidio |                                Circa 0,16 GB | Misura precedente con carico diverso                                  |

Sono massimi campionati dell'intero container in prove brevi e non omogenee. **Memoria e performance sono una valutazione successiva: 2 GB per container non è attualmente un requisito vincolante né un criterio di accettazione del refactor.** Il nuovo run funzionale non è un benchmark di risorse.

## Guide e utilizzo

- PoC: [Rizzo](poc-rizzo/README.md), [Horizon](poc-horizon/README.md), [Presidio](poc-presidio/README.md).
- [Installazione e test](tests/README.md).
- [Interfaccia comune](tests/contract/README.md).
- [Metodo e limiti dei test sulle risorse](tests/resources/README.md).

I PoC sono per prove locali con dati di test. Prima dell'integrazione servono accessi controllati, rete protetta e regole sui dati consentiti definite da una fonte fidata. Alcuni dati personali possono sfuggire anche con un esito di accettazione.
