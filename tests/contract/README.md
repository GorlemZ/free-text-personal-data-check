# Contratto comune dei tre servizi

## Richiesta e risposta

- `GET /health/ready`: `200 {"status":"ready"}` soltanto quando il detector è pronto; altrimenti `503 {"code":"detector_unavailable"}`. Un processo che fallisce prima del bind non espone un endpoint pronto.
- `POST /v1/analyze`, `Content-Type: application/json` (case-insensitive, parametri consentiti), JSON UTF-8 rigoroso.
- Metodo e path devono coincidere esattamente: query string, slash finale, path percent-encoded alternativo e metodi diversi ricevono 404, senza redirect.

```json
{"fields":[{"fieldId":"descrizione","text":"Vorrei informazioni.","allowedCategories":[]}]}
```

Da 1 a 10 campi; `fieldId` univoco e lungo 1–128 unità UTF-16. `text` può essere vuoto e contiene al massimo 50 unità separate dalla proprietà Unicode `White_Space`. ID e testo devono essere stringhe Unicode ben formate, senza surrogate isolate. Non si tronca l'input. Body massimo 1 MiB UTF-8. Lo schema è chiuso; tipi errati, membri ignoti e chiavi JSON duplicate, anche con escape differenti, sono invalidi.

`fieldId` viene restituito nella risposta: usare identificatori tecnici, senza dati personali. La policy `allowedCategories` deve provenire da un chiamante fidato; validare i nomi delle categorie non autorizza un utente finale a scegliere le eccezioni.

`allowedCategories` è facoltativo: omesso o vuoto vieta tutte le categorie. I duplicati non cambiano la policy. Catalogo chiuso:

`PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`.

Risposta business esclusivamente HTTP 200:

```json
{"verdict":"accepted","findings":[]}
```

```json
{"verdict":"rejected","findings":[{"fieldId":"descrizione","category":"PERSON"}]}
```

Ogni coppia vietata viene restituita una volta; ordine lessicografico per unità UTF-16 su `fieldId`, poi `category`. Le categorie consentite sono omesse. Un solo finding vietato basta al rifiuto. Nessun testo, valore estratto, span, score, etichetta nativa o versione del modello nella risposta.

## Errori e precedenza

| HTTP | Body | Condizione |
|---|---|---|
| 404 | `{"code":"not_found"}` | Metodo/path non ammessi |
| 400 | `{"code":"invalid_request"}` | Content-Type non ammesso |
| 413 | `{"code":"body_too_large"}` | Body oltre 1 MiB |
| 400 | `{"code":"invalid_request"}` | UTF-8, JSON, Unicode o schema invalido |
| 503 | `{"code":"detector_unavailable"}` | Detector indisponibile, output invalido o limite tecnico |

La tabella è nell'ordine di precedenza. Si valida l'intera richiesta prima dell'inferenza: input invalido resta 400 anche quando il detector non è disponibile. Gli errori non espongono verdetti o finding parziali. Un limite token può essere superato anche sotto 50 parole e produce 503.

## Semantica e limiti

Il servizio proietta internamente le etichette native nel catalogo comune **prima** della policy. Extra nativi conosciuti, come luoghi e date, non causano un rifiuto. Etichette sconosciute alla versione del motore e risultati malformati sono errori tecnici.

Il gold considera telefoni italiani e documenti italiani; email, carte e IBAN hanno portata internazionale. Un documento generico non diventa automaticamente CIE o patente italiana. Identificativi riconoscibili con checksum errato sono positivi nel gold: i filtri di validità dei singoli motori possono quindi causare falsi negativi misurati. Il contratto uniforme non implica detection equivalente.

`accepted` è un esito euristico, non una certificazione di assenza di dati personali. Servizi sperimentali locali, senza autenticazione: pubblicare solo su loopback.

## Verifiche ripetibili

Dalla root, dopo l’[installazione delle dipendenze di test](../README.md#installazione-ed-esecuzione):

```sh
python3 tests/contract/run.py
python3 tests/contract/run.py --engine rizzo
python3 tests/contract/run.py --base rizzo=http://127.0.0.1:18081
```

`fixtures.json` è condiviso dai tre handler. I server `serve-*` sostituiscono soltanto l'output nativo prima di adapter e policy; non provano la qualità dei modelli. `--base` usa solo i casi marcati `realSmoke` contro un servizio già avviato con detector reale, senza iniezione. Non avvia né ferma container esterni. Il confronto di qualità è separato in `../evaluation/`.
