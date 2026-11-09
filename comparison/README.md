# Confronto condiviso dei PoC (solo dati sintetici)

**Non inviare dati personali reali né esporre la porta pubblicamente.** Per test e benchmark **usa soltanto dati sintetici.** `accepted` significa soltanto che non sono state rilevate categorie vietate sopra la soglia: non prova l'assenza di dati personali. Il confronto non attesta idoneità alla produzione né equivalenza tra i detector.

## Esecuzione

Dalla root del repository:

```sh
docker build -t free-text-check:spacy-poc ./poc-spacy
docker build -t free-text-check:horizon-poc ./poc-horizon
node --test comparison/*.test.mjs
node comparison/run.mjs > .hermes/notes/poc-horizon-comparison-report.json
```

Il runner richiede Docker disponibile e immagini già costruite. Avvia container nuovi con 4 GiB RAM, swap=RAM, 2 CPU, host bind **127.0.0.1** e porta casuale, modelli offline, readiness entro 120 s, timeout 30 s per campo e 120 s per bulk/burst. Pulisce i container in `finally` e su SIGINT/SIGTERM. Non esegue download del modello né richieste a un servizio pubblico. Non stampa payload, risultati grezzi o eccezioni: solo JSON aggregato con ID sintetici, categorie e durate. Controllare le risorse Docker Desktop prima del run. La rete bridge resta tecnicamente disponibile per la pubblicazione della porta; le variabili `HF_HUB_OFFLINE` e `TRANSFORMERS_OFFLINE` disabilitano i download del modello Horizon, ma non costituiscono un blocco di rete generale.

## Corpus e tassonomia

`corpus.json` contiene 39 campioni (18 coppie positivo/negativo, un neutro e due casi allowlist). Una voce è un **singolo campo HTTP**, con ID privo di contenuto personale, `fieldId`, testo sintetico, allowlist, categorie attese e verdetto atteso annotato indipendentemente. Le 18 categorie e la copertura positiva/negativa sono testate in `corpus.test.mjs`:

| Supportate nominalmente da entrambi | Senza equivalente verificato in Horizon |
| --- | --- |
| `PERSON`, `ORGANIZATION`, `LOCATION`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IP_ADDRESS`, `MAC_ADDRESS`, `URL`, `IT_FISCAL_CODE` (regex locale, non `TAX_ID`) | `IT_DRIVER_LICENSE`, `IT_IDENTITY_CARD`, `IT_PASSPORT`, `IT_VAT_CODE`, `IBAN_CODE`, `CRYPTO`, `DATE_TIME`, `MEDICAL_LICENSE` |

Le 8 categorie non equivalenti restano **unsupported** per la matrice Horizon, mai FN; possono comunque produrre label native aggiuntive e un rifiuto. Un nome simile non certifica equivalenza semantica. La fixture CF misura una **forma plausibile**, non verifica checksum, controllo, anagrafe o omocodia; Presidio può non rilevarla. L'IBAN di sola forma ha checksum non verificato. Esempi di patente, identità, passaporto, P.IVA, crypto e licenza DEA USA sono illustrativi: potrebbero non superare validazioni specifiche e non dimostrano validità ufficiale. Le regex di documenti si possono sovrapporre; questi errori sono visibili nei risultati, non rimappati. URL e altre entità non sono di per sé dati personali: il corpus valuta il comportamento della policy *configurata*, non la natura legale dei dati.

## Metriche e contratto

Due richieste HTTP per campione: detector probe con `allowedEntityTypes: []` per la detection, policy probe con la allowlist annotata per il verdetto. Le categorie consentite non compaiono nei `findings`: non sarebbe corretto contarle come FN. Le confusion matrix sono per campione × categoria supportata; il verdetto è per campione ed è confrontato con `expectedVerdict` indipendente. Errori HTTP/tecnici in una probe sono fuori **da entrambe** le matrici, ma compaiono in `attempted/completed/technicalErrors`. Le label Horizon extra sono diagnosticate e possono influenzare il verdetto, ma non entrano nelle 18 metriche Presidio. I singoli FP/FN non interrompono la suite; hard fail su schema, contratto, perdite di testo e minimi neutro/e-mail/CF Horizon.

Le risposte 200 sono validate con `verdict`, `modelPolicyVersion` e `findings` ordinati, unici, solo campo/categoria; nei test a campo singolo, ogni `fieldId` deve coincidere con la richiesta e la policy probe non può restituire una categoria allowlisted. 400/503 hanno esclusivamente un codice generico. Una risposta HTTP ricevuta con content-type o JSON malformato è una violazione del contratto che interrompe il run; un timeout di trasporto è contato separatamente come errore tecnico. I test del handler iniettano inferenza per 503 nel secondo campo, label ignota e saturazione deterministica a quattro slot; il burst Docker a otto richieste è solo osservazionale e non presuppone 503. Il limite `>512` token si applica solo a Horizon. Bulk = una richiesta da 11 campi diversi (catalogo attuale); il payload con 17 campi ripete lo stesso ID e verifica un rifiuto combinato, **non** isola il limite di 16 (impossibile costruire 17 ID unici con il catalogo di 11).

Cold latency = prima richiesta dopo readiness (startup escluso); warm = 5 richieste successive. Si riportano N, p50 e p95 in **ms** (percentili nearest-rank); una misura cold non è una distribuzione. Corpus a campo singolo, bulk e burst hanno tempi distinti. Nessuno SLA è implicito.

## Risultato della prova locale (4 novembre 2026)

Il report riproducibile è in `.hermes/notes/poc-horizon-comparison-report.json` con ID delle immagini e policy. 39/39 campioni completati su entrambi, nessun errore tecnico. Verdetti (TP/FP/FN/TN, *non* detection per categoria): spaCy **16/10/2/11**; Horizon **16/11/2/10**. La presenza di molti falsi rifiuti su questo piccolo corpus artificiale impedisce una conclusione di qualità produttiva. Cold dopo readiness: spaCy 137,47 ms, Horizon 31,87 ms; warm p50/p95 su 5: spaCy 5,87/6,66 ms, Horizon 74,37/84,67 ms. Sono misure locali esplorative, non confronti controllati su deployment rappresentativo. L'assenza di 503 nel burst reale non prova che la coda non possa saturare: il test deterministico del handler verifica il quinto 503 quando quattro slot sono occupati.
