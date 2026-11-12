# Node Rizzo PII — spike funzionale

Servizio HTTP e detection locale nel processo Node. Il container finale usa Node e librerie native ONNX, senza Python. Contratto minimale in `CONTRATTO.md`; valutazione separata in `../evaluation-external/`. Performance, memoria e concorrenza sono rinviate alla fase conclusiva futura.

## Avvio

Da questa directory, con Node 24:

```sh
npm ci
npm run prefetch
npm test
npm run smoke
npm start
```

`prefetch` scarica artefatti pubblici fissati per revisione/hash. I pesi non sono versionati. `smoke` esegue inferenza reale, controlla PERSON, email in coda e overflow token esplicito, senza stampare i testi. Nessuna inferenza remota.

```sh
docker build -t free-text-check:node-rizzo-spike .
docker run --rm -p 127.0.0.1:18081:8000 free-text-check:node-rizzo-spike
```

I download delle dipendenze avvengono nella build; il servizio usa artefatti locali verificati all'avvio. La pubblicazione su loopback non isola l'egress del container. Lo smoke può essere eseguito separatamente con `docker run --rm --network none free-text-check:node-rizzo-spike node scripts/smoke.mjs`.

## Motore e limiti

Modello sorgente `rizzoaiacademy/rizzo-pii-0.3B`, export ONNX community `andrearuffini/local-privacy-runtime-pii-detector`. Revisioni e hash in `model-manifest.json`; licenza dell'export in `MODEL_LICENSE`. La parità PyTorch/ONNX è dichiarata dall'autore, non verificata da questo spike. I dati Rizzo condividono provenienza col modello: non sono un test indipendente.

Il tokenizer vede l'intero input. BIO produce internamente entità, proiettate nel catalogo applicativo; valori e span non escono dall'API. `ID_DOC` e `CONTO` generici non diventano automaticamente documento italiano o IBAN. Regole TypeScript aggiungono CF/omocodia, P.IVA, IBAN secondo le lunghezze del registro `ibantools`, carte, telefoni italiani, CIE e patenti. I checksum non sono filtri di esclusione.

Le regole sono euristiche: alcune richiedono un contesto precedente ravvicinato o un valore isolato. Sono coperti formati di CIE elettronica e patente, non ogni documento storico. La categoria telefono è decisa esclusivamente dalle regole sul testo originale: un frammento NER può omettere un prefisso estero e non deve aggirare il filtro geografico. Sono riconosciuti cellulari nazionali e fissi con contesto, con eventuale +39/0039; sequenze di più numeri contigui possono essere perse dal matcher greedy. Email, carte e IBAN hanno copertura internazionale per forma; nessuna promessa di riconoscimento universale. Nomi e altri label dipendono anche dal modello. Accepted non prova assenza di dati personali.

## Evidenza corrente — PARTIAL

- Suite API/regole/modello/ABI: 19 test passati; sessioni finte per i test unitari, socket HTTP reali per il contratto.
- Inferenza reale verificata sia su macOS sia nel container Linux ARM64; smoke con rete disabilitata riuscito.
- Smoke HTTP nel container: testo neutro accepted; email vietata rejected; stessa categoria consentita accepted; input invalido 400.
- Review indipendente finale del servizio: PASS, chiusi i difetti su prefissi telefonici esteri, punto e whitespace Unicode. Regressioni unit e HTTP reale nel container verificate.
- Primo confronto HTTP completo in `../evaluation-external/results/first-http/`: 212/212 richieste riuscite, zero errori tecnici/contrattuali; 53 casi e 54 testi, gold invariato.
- Raw verdict Node: TP40/TN10/FP2/FN1, accuracy94,34%; Presidio: TP36/TN4/FP8/FN5, accuracy75,47%. Il confronto raw non è equal-policy: Presidio conserva categorie extra. Pilot piccolo/correlato; non basta per scegliere un vincitore.
- Limiti osservati Node: carta d'identità mancata nel caso `targeted-07`; falsi positivi di telefono(1), P.IVA(4), IBAN(3) nella detection. Nessun tuning dopo le predizioni.
- Pacchetti Python nel container Node: nessuno nell'inventario dpkg. Container del run rimossi; report rigenerati offline byte-identici. Audit indipendente delle matrici PASS: tutte le 72 matrici detection, 8 policy e 212 osservazioni ricontate senza usare lo scorer di produzione; JSON/CSV/Markdown coerenti.

Il primo avvio Linux ha esposto due versioni native ONNX incompatibili. Il pin unico `onnxruntime-node@1.30.0`, condiviso con Transformers.js, risolve il caricamento; un test del lockfile previene la reintroduzione di ABI duplicate. La prova resta uno spike, non un servizio pronto per produzione.
