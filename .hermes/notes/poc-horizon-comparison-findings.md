# Findings — PoC Horizon/spaCy

- Checkout locale `main` pulito e coincidente con `origin/main` (`3ead695fab0780fb035d8ee67c9cec5fb4a86bc1`).
- Software corrente: FastAPI/Presidio/spaCy, endpoint `/health/ready`, `/v1/analyze`, benchmark, Dockerfile, 18 policy categories, test e corpus sintetico.
- Hub API modello Horizon a `ef0eff8e63c1711ec0c997c5ca9ea3b78a068684`: Apache-2.0, italiano dichiarato, `onnx/model_quantized.onnx` 641300235 byte, tokenizer.json 34363288 byte, labels BIO comprendono `PERSON`, `ORGANIZATION`, `LOCATION`, `EMAIL`, `PHONE`, `TAX_ID` ecc. `TAX_ID` NON è automaticamente `IT_FISCAL_CODE`.
- `npm view @huggingface/transformers version`: `4.3.2` al momento della verifica.
- Benchmark su dieci esempi sintetici identici: Horizon riconosce PERSON ed EMAIL_ADDRESS (2/2 categorie comuni attese), non emette IT_FISCAL_CODE sul codice di test (categoria non equivalente/non supportata); `commonPolicy` registra 1 falso positivo rispetto al perimetro comune, mentre la policy completa rifiuta comunque la richiesta. spaCy riconosce il codice fiscale ma produce 2 falsi positivi LOCATION. Dataset minuscolo, niente inferenze generali sulla qualità.
- Docker finale Horizon: dimensione immagine 1.582.037.336 byte, modello LFS q8 641.300.235 byte + tokenizer 34.363.288 byte; spaCy immagine 847.664.619 byte. Dimensione su disco e RSS/container sono misure differenti.
- I dati reali sono esclusi dai test e il modello va scaricato solo durante la preparazione, non in request.
- Il progetto richiede nuovi piani in `.hermes/plans/`, appunti in `.hermes/notes/`. PWF init invocato con `cwd` esplicito nella prima; i suoi due file di appunti sono symlink verso `.hermes/notes/`.
