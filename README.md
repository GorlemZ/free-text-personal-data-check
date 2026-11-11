# Controllo dei dati personali nei campi liberi

Il servizio rileva categorie di dati personali nei campi liberi, applica le categorie consentite per campo e restituisce un verdetto tramite API HTTP. Il confronto usa soltanto testi sintetici.

| PoC | Motore | Cartella |
| --- | --- | --- |
| Presidio | Python + spaCy italiano | `poc-spacy/` |
| Horizon | Node.js + Transformers.js/ONNX q8 e recognizer strutturati | `poc-horizon/` |

## Perimetro corrente

Gold semantico a nove categorie: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`. La carta d'identità nel gold è la CIE corrente; la patente usa soltanto la morfologia documentata per un sottotipo di duplicati italiani, senza verifica di assegnazione o del carattere di controllo. Policy, checksum e confini sono descritti in `comparison/README.md` e `comparison/manifest.json`.

Le API mantengono etichette **native**: Presidio usa i nomi italiani del gold, mentre Horizon espone `EMAIL`, `PHONE` (modello), `PHONE_NUMBER` (regola), `NATIONAL_ID` e `DRIVER_LICENSE` per le rispettive categorie. Il solo mapping per il confronto è `comparison/functional/category-map.mjs`, applicato all'allowlist prima della richiesta e ai finding dopo la risposta. Le due label Horizon del telefono confluiscono nella medesima categoria del gold; nessuna API espone categorie armonizzate per il comparatore.

Il corpus di bozza è `comparison/corpus.json`, un array di sole stringhe letterali complete; `comparison/gold.json` contiene le annotazioni separate, collegate tramite `textIndex`. Criteri e stato della review sono in `comparison/manifest.json`: **pending, non congelato**. Dopo revisione positiva e congelamento, il confronto potrà inviare richieste HTTP ai servizi Docker e produrre sensibilità/precisione per categoria e correttezza del verdetto. Nessun hash del gold, metrica prestazionale o secondo run obbligatorio. I risultati storici in `comparison/reports/historical/` e la baseline a sette categorie restano nel loro contratto originale e non sono confrontabili automaticamente con il nuovo gold.

## Perché un'API HTTP

L'API mantiene stabile l'integrazione finché protocollo, schema e significato delle **etichette native** restano invariati; il passaggio di Horizon da `EMAIL_ADDRESS`/`PHONE_NUMBER` armonizzati alle label native è un cambio di contratto da recepire nei client. `modelPolicyVersion` identifica la policy effettiva; il runner registra quella osservata e ne verifica la coerenza nelle risposte dello stesso servizio. Una libreria nel processo chiamante ridurrebbe il trasporto, ma integrerebbe runtime e risorse del detector nel chiamante.

`rejected` indica almeno una categoria rilevata e vietata nel campo; `accepted` non prova l'assenza di dati personali.

## Verifiche

Dalla root, con le dipendenze dei PoC installate e Node.js ≥22:

```sh
(cd poc-spacy && uv run --frozen --extra dev pytest -q)
(cd poc-horizon && npm test)
node --test comparison/tests/*.test.mjs
node comparison/functional/run.mjs --validate-only
```

Il comando validate-only esegue controlli di schema, coerenza e tokenizer locale, non inferenza né Docker. Il runner mantenuto è `comparison/functional/run.mjs`; istruzioni, gate e metodo in `comparison/README.md`, test in `comparison/tests/README.md`.

Le annotazioni del gold vanno revisionate indipendentemente dalle predizioni. Un run locale usa immagini Docker già costruite, rileva automaticamente gli image ID effettivi e rimuove i propri container. I servizi sono pubblicati solo su loopback; il bridge predefinito non garantisce isolamento egress. Il confronto separa detection senza allowlist e policy con allowlist. Non inviare dati personali reali né esporre i servizi pubblicamente.
