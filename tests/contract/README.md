# Contratto HTTP BardsAI

La suite esercita il servizio BardsAI tramite un server HTTP reale con inferenza sostituita da fixture deterministiche.

## Endpoint

- `GET /health/ready`: `200 {"status":"ready"}` quando modello e servizio sono pronti; altrimenti `503 {"code":"detector_unavailable"}`.
- `POST /v1/analyze`: richiede `Content-Type: application/json`; parametri del media type e case differenti sono consentiti.
- Path, slash finali, query string, path percent-encoded alternativi e metodi diversi ricevono 404.

## Richiesta

```json
{
  "fields": [
    {
      "fieldId": "description",
      "text": "testo da analizzare",
      "allowedCategories": []
    }
  ]
}
```

Vincoli principali:

- da 1 a 10 campi;
- `fieldId` univoco, da 1 a 128 unità UTF-16;
- testo al massimo di 50 parole Unicode;
- stringhe Unicode ben formate;
- body massimo 1 MiB UTF-8;
- schema chiuso, senza proprietà ignote;
- `allowedCategories` omesso significa deny-all; `[]` esplicito ha la stessa semantica.

## Risposta

```json
{
  "verdict": "rejected",
  "findings": [{ "fieldId": "description", "category": "PERSON" }]
}
```

I finding sono deduplicati e ordinati per campo e catalogo. Il servizio non restituisce testo, span, score o label native.

Categorie: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`.

## Errori

| HTTP | Body                              | Significato                                |
| ---: | --------------------------------- | ------------------------------------------ |
|  400 | `{"code":"invalid_request"}`      | input, JSON o media type non valido        |
|  404 | `{"code":"not_found"}`            | endpoint non riconosciuto                  |
|  413 | `{"code":"body_too_large"}`       | body oltre 1 MiB                           |
|  503 | `{"code":"detector_unavailable"}` | modello, output o capacità non disponibile |

La validazione precede l'ammissione. La coda bounded mappa overflow e scadenze a 503. Errori tecnici e output malformati falliscono chiusi e non espongono risultati parziali.

## Esecuzione

```sh
python3 tests/contract/run.py
python3 tests/contract/run.py --engine bardsai
python3 tests/contract/run.py --base bardsai=http://127.0.0.1:18084
```

La prima forma avvia la fixture BardsAI. `--base` usa un servizio già avviato. Le fixture contengono 114 casi e non richiedono i pesi del modello.
