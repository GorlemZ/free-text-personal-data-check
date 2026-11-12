# Contratto HTTP dello spike

`GET /health/ready` → 200 `{"status":"ready"}` dopo caricamento del modello. L'avvio fallisce se artefatti, hash o runtime non sono disponibili.

`POST /v1/analyze`, `Content-Type: application/json`, body JSON UTF-8:

```json
{"fields":[{"fieldId":"descrizione","text":"Vorrei informazioni.","allowedCategories":[]}]}
```

- Da 1 a 10 campi, ID stringa univoco non vuoto (massimo 128 unità UTF-16).
- `text` è una stringa, anche vuota; massimo 50 parole, separate da Unicode White_Space. Nessun troncamento.
- `allowedCategories` è facoltativo; omesso/vuoto vieta tutte le categorie. Duplicati nella lista non cambiano la policy.
- Catalogo chiuso: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`.
- Membri JSON sconosciuti, chiavi duplicate (anche escaped), tipi errati e categorie sconosciute sono input invalidi. Body massimo 1 MiB, guardia di trasporto distinta dal limite parole.

Risposta business HTTP 200, soltanto:

```json
{"verdict":"accepted","findings":[]}
```

oppure `{"verdict":"rejected","findings":[{"fieldId":"descrizione","category":"PERSON"}]}`.

Un qualsiasi finding vietato rende la richiesta rejected. Sono restituite tutte le coppie distinte campo/categoria vietata, ordinate per ID/categoria; categorie presenti ma consentite sono omesse. Mai valori, estratti, span, score, label interne o dettagli motore. I finding restano euristici: accepted non è una certificazione di assenza di dati personali.

| HTTP | Body |
|---|---|
| 400 | `{"code":"invalid_request"}` |
| 413 | `{"code":"body_too_large"}` |
| 404 | `{"code":"not_found"}` |
| 503 | `{"code":"detector_unavailable"}` |

Gli errori non contengono verdict né finding parziali. Il limite token del modello può essere superato anche con meno di 50 parole: produce 503, mai accepted su un prefisso. Validazione dell'intera richiesta prima di qualunque inferenza. Nessun logging applicativo del testo. Servizio locale sperimentale senza autenticazione; pubblicare solo su loopback per la prova.
