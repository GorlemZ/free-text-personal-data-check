# Controllo dei dati personali nei campi liberi

Tre PoC locali confrontano il riconoscimento di dati personali attraverso **la stessa API e la stessa policy per campo**. Il flusso è: validazione dell'input → detection → conversione nel catalogo comune → applicazione delle categorie consentite → verdetto.

| Cartella | Stack e responsabilità |
|---|---|
| [poc-rizzo](poc-rizzo/README.md) | Node HTTP, Rizzo ONNX con Transformers.js/ONNX Runtime e regole TypeScript |
| [poc-horizon](poc-horizon/README.md) | Node HTTP, Horizon ONNX q8 con Transformers.js e riconoscitori TypeScript |
| [poc-presidio](poc-presidio/README.md) | FastAPI/Uvicorn, Presidio Analyzer e spaCy italiano |
| [tests](tests/README.md) | Suite dei motori, contratto condiviso, pilot annotato e runner comparativo |

I container Rizzo e Horizon eseguono la detection nel processo Node, senza Python. Presidio usa un runtime Python separato. Modelli e cache restano locali e fuori da Git.

## Da dove arriva ogni categoria

Il catalogo comune comprende nove categorie. Il confronto riguarda **pipeline complete**, non soltanto i modelli neurali: ogni PoC combina riconoscimento, traduzione delle etichette e filtri prima di applicare la stessa policy per campo.

**Modello** indica il riconoscimento neurale; **regola/recognizer nostro** indica codice del PoC; **recognizer nativo** indica un componente predefinito di Presidio.

| Categoria comune | Rizzo | Horizon | Presidio |
|---|---|---|---|
| `PERSON` | Modello: `FULLNAME` | Modello: `PERSON` | spaCy italiano: `PER` → `PERSON` |
| `EMAIL_ADDRESS` | Modello `EMAIL` + regola nostra | Modello: `EMAIL` | Recognizer nativo |
| `PHONE_NUMBER` | Solo regole nostre | Modello `PHONE` + recognizer nostro, con validazione | Recognizer nativo + nostro filtro Italia |
| `IT_FISCAL_CODE` | Modello `CF` + regola nostra | Recognizer nostro | Recognizer nativo |
| `IT_VAT_CODE` | Modello `PIVA` + regola nostra | Recognizer nostro | Recognizer nativo |
| `IBAN_CODE` | Modello `IBAN` + regola nostra | Recognizer nostro, limitato agli IBAN italiani | Recognizer nativo |
| `CREDIT_CARD` | Modello `CREDITCARDNUMBER` + regola nostra | Modello `CREDIT_CARD` + recognizer nostro, con validazione | Recognizer nativo |
| `IT_IDENTITY_CARD` | Solo regole nostre | Modello `NATIONAL_ID`, filtrato per forma italiana | Recognizer nativo |
| `IT_DRIVER_LICENSE` | Solo regole nostre | Modello `DRIVER_LICENSE`, filtrato per forma italiana | Recognizer nativo |

Le categorie indicano i percorsi di riconoscimento implementati, non una garanzia di rilevamento. In Horizon i candidati strutturati del modello devono superare anche i controlli sullo span originale; i documenti richiedono forma italiana e contesto appropriato oppure un valore isolato. In Rizzo `TELEPHONENUM` e il generico `ID_DOC` non alimentano direttamente le categorie comuni. In Horizon `TAX_ID` non viene equiparato a codice fiscale e `BANK_ACCOUNT` non viene equiparato a IBAN.

Categorie, API e policy sono uniformate; regole di formato, checksum e modelli restano differenti. Gli extra conosciuti fuori catalogo vengono esclusi prima della policy.

## Uso

- **Avviare un servizio:** seguire il README del relativo PoC; tutti i comandi partono dalla root.
- **Eseguire le verifiche:** [installazione e suite](tests/README.md).
- **Integrare l'API:** [contratto HTTP](tests/contract/README.md), fonte unica per schema, categorie, limiti ed errori.
- **Confrontare i motori:** [metodo e comandi del pilot](tests/evaluation/README.md).

`POST /v1/analyze` riceve campi con testo e categorie consentite. Restituisce `accepted` oppure `rejected`, con sole coppie `fieldId`/`category` vietate. Gli extra conosciuti del motore sono esclusi **prima** della policy. Modelli e riconoscitori mantengono le proprie differenze di detection.

**Uso locale con dati sintetici:** pubblicare le porte su loopback. I PoC non autenticano il chiamante; la policy deve provenire da una fonte fidata. `accepted` è un esito euristico. Una futura integrazione richiede controllo degli accessi e protezione di rete.

## Risultati disponibili

Il pilot del **12 novembre 2026** ha completato **546/546 richieste**, senza errori tecnici o contrattuali: 91 casi su 82 testi distinti. Il campione è correlato e già parzialmente utilizzato; i risultati descrivono questi casi. Performance e memoria restano una valutazione separata.

- [Metriche per motore, categoria e fonte](tests/evaluation/results/uniform-http/report.md)
- [Immagini, versioni e contesto del run](tests/evaluation/results/uniform-http/run-context.json)
- [Audit indipendente](tests/evaluation/results/uniform-http/audit.md)
