# Confronto condiviso dei PoC (solo dati sintetici)

**Non inviare dati personali reali né esporre la porta pubblicamente.** Per test e benchmark **usa soltanto dati sintetici.** `accepted` significa soltanto che non sono state rilevate categorie vietate sopra la soglia: non prova l'assenza di dati personali. Il confronto non attesta idoneità alla produzione né equivalenza tra i detector.

Il [README principale](../README.md) spiega obiettivi dei team Infra/Business e scelta API vs libreria. La [guida ai test](tests/README.md) distingue le prove del runner dalla valutazione dei detector. Qui `corpus.json` è il dataset annotato; `run.mjs` è la prova HTTP su container reali; `tests/` contiene i test automatici del runner.

## Esecuzione

Dalla root del repository (Node.js ≥22, `npm`, Docker; il prefetch richiede l'accesso agli artefatti del modello):

```sh
(cd poc-horizon && npm ci && npm run prefetch)  # Dockerfile copia models/ e ne verifica il manifest
docker build -t free-text-check:spacy-poc ./poc-spacy
docker build -t free-text-check:horizon-poc ./poc-horizon
node --test comparison/tests/*.test.mjs
(umask 077; set -C; node comparison/run.mjs > "$HOME/poc-comparison-report.json")
```

Il runner richiede Docker disponibile e immagini già costruite. Avvia container nuovi con 4 GiB RAM, swap disabilitato (`--memory-swap=4g`), 2 CPU, host bind **127.0.0.1** e porta casuale, modelli offline, readiness entro 120 s, timeout 30 s per richiesta standard e 120 s per bulk/burst. Pulisce i container in `finally` e su SIGINT/SIGTERM. Non esegue download del modello né richieste a un servizio pubblico. Non stampa payload, risultati grezzi o eccezioni: il JSON contiene metriche aggregate e diagnostiche per ID sintetico, categoria e verdetto, senza testo o span. Controllare le risorse Docker Desktop prima del run. La rete bridge resta tecnicamente disponibile per la pubblicazione della porta; le variabili `HF_HUB_OFFLINE` e `TRANSFORMERS_OFFLINE` disabilitano i download del modello Horizon, ma non costituiscono un blocco di rete generale. Il report in `$HOME` viene creato con permessi riservati (`umask 077`); `set -C` impedisce di sovrascrivere un file esistente. Per ripetere il run, scegliere un nuovo nome. La condivisione delle diagnostiche richiede valutazione.

## Corpus e tassonomia

`corpus.json` contiene 39 campioni (18 coppie positivo/negativo, un neutro e due casi allowlist). Una voce è un **singolo campo HTTP**, con ID privo di contenuto personale, `fieldId`, testo sintetico, allowlist, categorie attese e verdetto atteso annotato indipendentemente. Le 18 categorie e la copertura positiva/negativa sono testate in [`tests/corpus.test.mjs`](tests/corpus.test.mjs):

| Supportate nominalmente da entrambi | Senza equivalente verificato in Horizon |
| --- | --- |
| `PERSON`, `ORGANIZATION`, `LOCATION`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `CREDIT_CARD`, `IP_ADDRESS`, `MAC_ADDRESS`, `URL`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE` (ultime tre da recognizer locali) | `IT_DRIVER_LICENSE`, `IT_IDENTITY_CARD`, `IT_PASSPORT`, `CRYPTO`, `DATE_TIME`, `MEDICAL_LICENSE` |

Le 6 categorie non equivalenti restano per ora **unsupported** per la matrice Horizon, mai FN; possono comunque produrre label native aggiuntive e un rifiuto. Un nome simile non certifica equivalenza semantica. La fixture CF misura una **forma plausibile**, non verifica checksum, controllo, anagrafe o omocodia; Presidio può non rilevarla. La fixture P.IVA misura 11 cifre di sola forma, senza attribuzione né checksum; l'IBAN IT ha 27 caratteri di sola forma e checksum non verificato. Esempi di patente, identità, passaporto, crypto e licenza DEA USA sono illustrativi: potrebbero non superare validazioni specifiche e non dimostrano validità ufficiale. Le regex di documenti si possono sovrapporre; questi errori sono visibili nei risultati, non rimappati. URL e altre entità non sono di per sé dati personali: il corpus valuta il comportamento della policy *configurata*, non la natura legale dei dati.

## Metriche e contratto

Due richieste HTTP per campione: detector probe con `allowedEntityTypes: []` per la detection, policy probe con la allowlist annotata per il verdetto. Le categorie consentite non compaiono nei `findings`: non sarebbe corretto contarle come FN. Le confusion matrix sono per campione × categoria supportata; il verdetto è per campione ed è confrontato con `expectedVerdict` indipendente. Errori HTTP/tecnici in una probe sono fuori **da entrambe** le matrici, ma compaiono in `attempted/completed/technicalErrors`. Le label Horizon extra sono diagnosticate e possono influenzare il verdetto, ma non entrano nelle 18 metriche Presidio. I singoli FP/FN non interrompono la suite; hard fail su schema, contratto, perdite di testo e minimi neutro/e-mail/CF Horizon.

Le risposte 200 sono validate con `verdict`, `modelPolicyVersion` e `findings` ordinati, unici, solo campo/categoria; nei test a campo singolo, ogni `fieldId` deve coincidere con la richiesta e la policy probe non può restituire una categoria allowlisted. 400/503 hanno esclusivamente un codice generico. Una risposta HTTP ricevuta con content-type o JSON malformato è una violazione del contratto che interrompe il run; un timeout di trasporto è contato separatamente come errore tecnico. I test del handler iniettano inferenza per 503 nel secondo campo, label ignota e saturazione deterministica a quattro slot; il burst Docker a otto richieste è solo osservazionale e non presuppone 503. Il limite `>512` token si applica solo a Horizon. Bulk = una richiesta da 11 campi diversi (catalogo attuale); il payload con 17 campi ripete lo stesso ID e verifica un rifiuto combinato, **non** isola il limite di 16 (impossibile costruire 17 ID unici con il catalogo di 11).

Cold latency = prima richiesta dopo readiness (startup escluso); warm = 5 richieste successive. Si riportano N, p50 e p95 in **ms** (percentili nearest-rank); una misura cold non è una distribuzione. Corpus a campo singolo, bulk e burst hanno tempi distinti. Nessuno SLA è implicito.

## Risultato della prova locale (4 novembre 2026)

Il report riproducibile è in `.hermes/notes/poc-horizon-comparison-report.json` con ID delle immagini e policy. 39/39 campioni completati su entrambi, nessun errore tecnico. Verdetti (TP/FP/FN/TN, *non* detection per categoria): spaCy **16/10/2/11**; Horizon **16/11/2/10**. La presenza di molti falsi rifiuti su questo piccolo corpus artificiale impedisce una conclusione di qualità produttiva. Cold dopo readiness: spaCy 137,47 ms, Horizon 31,87 ms; warm p50/p95 su 5: spaCy 5,87/6,66 ms, Horizon 74,37/84,67 ms. Sono misure locali esplorative, non confronti controllati su deployment rappresentativo. L'assenza di 503 nel burst reale non prova che la coda non possa saturare: il test deterministico del handler verifica il quinto 503 quando quattro slot sono occupati.

## Risultato della prova locale (9 novembre 2026)

Immagini ricostruite: spaCy `sha256:f9a0281d6cf5b7ee64df4add63152dce85215df73d4339ba36a767e419b75418`, Horizon `sha256:4a3dfc5f48e7bb6ae075b92b2cef7d3b6f90b4765708e10a50e8001dd3ba5d67`. Una copia locale privata del report conserva metriche aggregate e diagnostiche per ID sintetico/categoria, senza testi; la condivisione dei dettagli richiede valutazione. Il runner assegna a ciascun container **2 CPU** (`--cpus=2`), 4 GiB RAM e swap disabilitato; un container effimero avviato dalla stessa immagine Horizon con gli stessi limiti ha restituito `cpu.max=200000 100000` e `memory.max=4294967296`. La quota CPU non configura due thread ONNX: Horizon conserva l'impostazione predefinita.

Entrambi: **39/39** campioni completati, **0** errori tecnici; verdetti TP/FP/FN/TN spaCy **16/10/2/11**, Horizon **16/11/2/10**. Prima richiesta dopo readiness (cold): spaCy **128,04 ms**, Horizon **38,74 ms**. Warm p50/p95 su **5** richieste: spaCy **5,92/10,29 ms**, Horizon **98,90/102,89 ms**. Le 78 richieste del corpus per motore hanno p50/p95 spaCy **5,95/10,56 ms**, Horizon **89,16/192,87 ms**. Bulk da 11 campi: spaCy **28,32 ms**, Horizon **702,89 ms**; burst di 8 richieste: 8/8 completate per entrambi. Questi numeri descrivono un solo run con input sintetici e altri container attivi sulla macchina: non sono stime di accuratezza generale, SLA o sizing produttivo.
