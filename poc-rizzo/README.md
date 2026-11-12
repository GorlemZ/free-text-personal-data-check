# PoC Rizzo

Servizio Node.js 24: modello Rizzo ONNX, decoder BIO e regole TypeScript. [Contratto HTTP comune](../tests/contract/README.md) · [Test](../tests/README.md) · [Valutazione](../tests/evaluation/README.md).

## Avvio dalla root

```sh
npm --prefix poc-rizzo ci
npm --prefix poc-rizzo run prefetch
npm --prefix poc-rizzo run smoke
npm --prefix poc-rizzo start
```

`prefetch` scarica gli artefatti fissati in [model-manifest.json](model-manifest.json); `smoke` esegue inferenza reale e verifica PERSON, email in coda e gestione dell'overflow token. Il servizio usa solo modelli locali. Bind predefinito `127.0.0.1:8000`, configurabile con `BIND_HOST` e `PORT`.

Dopo il prefetch:

```sh
docker build -t free-text-check:rizzo-uniform ./poc-rizzo
docker run --rm -p 127.0.0.1:18081:8000 free-text-check:rizzo-uniform
```

Attendere `GET /health/ready`. Il container finale non contiene Python. Per uno smoke reale senza rete, sull'immagine già costruita:

```sh
docker run --rm --network none free-text-check:rizzo-uniform node scripts/smoke.mjs
```

## Detection e limiti

- Il tokenizer riceve l'intero testo; l'overflow produce un errore tecnico invece di troncare l'input.
- Il decoder BIO proietta le entità nel catalogo comune. `ID_DOC` generico resta escluso dai documenti italiani; etichette note fuori catalogo sono ignorate, output malformati o etichette sconosciute falliscono.
- Le regole aggiungono CF anche con omocodia, P.IVA, IBAN secondo le lunghezze di `ibantools`, carte, telefoni italiani, CIE e patenti. I checksum non sono filtri di esclusione.
- Telefoni decisi esclusivamente dalle regole sul testo originale: mobile nazionale, fisso con contesto, eventuali prefissi `+39`/`0039`. Il matcher può perdere numeri contigui; i frammenti NER non aggirano il filtro geografico.
- Alcuni identificativi richiedono contesto ravvicinato o valore isolato. La copertura dei documenti riguarda i formati implementati, mentre email, carte e IBAN hanno portata internazionale per forma.

Il pin `onnxruntime-node@1.30.0`, condiviso con Transformers.js, evita ABI native incompatibili. Una regressione sul lockfile ne verifica l'unicità.

## Modello e licenza

Sorgente `rizzoaiacademy/rizzo-pii-0.3B`; export community `andrearuffini/local-privacy-runtime-pii-detector`. Revisioni e hash sono nel manifest, licenza dell'export in [MODEL_LICENSE](MODEL_LICENSE). La parità PyTorch/ONNX è dichiarata dall'autore. I testi Rizzo del pilot condividono provenienza con il modello: considerare questa dipendenza nell'interpretazione delle metriche.
