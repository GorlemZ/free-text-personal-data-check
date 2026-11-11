# Controllo dei dati personali nei campi liberi

Il servizio rileva categorie di dati personali nei campi liberi, applica le categorie consentite per campo e restituisce un verdetto tramite API HTTP. Il confronto usa soltanto testi sintetici.

| PoC | Motore | Cartella |
| --- | --- | --- |
| Presidio | Python + spaCy italiano | `poc-spacy/` |
| Horizon | Node.js + Transformers.js/ONNX q8 e recognizer strutturati | `poc-horizon/` |

## Perimetro corrente

`PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`. Policy, checksum e confini sono descritti in `comparison/README.md` e `comparison/manifest.json`.

Il gold unico è `comparison/corpus.json`; criteri e stato della review sono in `comparison/manifest.json`. Il confronto invia richieste HTTP ai servizi Docker e produce sensibilità/precisione per categoria e correttezza del verdetto. Nessun hash del gold, metrica prestazionale o secondo run obbligatorio. I risultati storici in `comparison/reports/historical/` mantengono il precedente contratto e non sono confrontabili automaticamente con il gold corrente.

## Perché un'API HTTP

L'API mantiene stabile l'integrazione se il detector o adattatore preserva protocollo, schema e significato delle categorie. `modelPolicyVersion` identifica la policy effettiva; il runner registra quella osservata e ne verifica la coerenza nelle risposte dello stesso servizio. Una libreria nel processo chiamante ridurrebbe il trasporto, ma integrerebbe runtime e risorse del detector nel chiamante.

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
