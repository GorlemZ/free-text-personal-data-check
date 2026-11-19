# Rapporto tecnico — BardsAI v2

## Sintesi

Il repository contiene un solo detector: BardsAI v2. Il servizio conserva il contratto HTTP di validazione, readiness, lifecycle, admission control e risposta minimizzata, mentre l'inferenza usa il modello multilingue BardsAI in formato ONNX q8 su CPU.

Modello e runtime:

- modello `bardsai/eu-pii-anonimization-multilang-v2`;
- revisione `07a9a69b0d75c551f5f9450b290f864bfc7dfb51`;
- Transformers.js 4.3.2;
- `dtype: "q8"`, `device: "cpu"`;
- configurazione pubblicata `intraOpNumThreads: 1`, `interOpNumThreads: 1`;
- asset locali verificati tramite SHA-256 e caricamento offline.

## Decoder e policy

Il port TypeScript del decoder ufficiale applica finestre da 512 token, corpo utile 510, overlap 128, softmax, pooling B/I, aggregazione subtoken/parola e merge tra finestre. Output vuoti o malformati, logits non finiti e cataloghi incompatibili falliscono chiusi.

Il mapping del modello è conservativo:

- `PERSON_NAME` → `PERSON`;
- `EMAIL_ADDRESS` → `EMAIL_ADDRESS`;
- `PHONE_NUMBER` → `PHONE_NUMBER`;
- `PAYMENT_CARD` → `CREDIT_CARD`.

Le categorie italiane strutturate sono gestite da riconoscitori separati. La risposta pubblica contiene soltanto verdetto, `fieldId` e categoria; testo, offset, score e label native restano esclusi.

## Valutazione funzionale

Golden `category-detection-1`, 142 casi, eseguito con policy deny-all:

| Misura            |        Risultato |
| ----------------- | ---------------: |
| Verdetti corretti | 132/142 — 92,96% |
| Body esatti       | 125/142 — 88,03% |
| TP                |               96 |
| FP                |                7 |
| FN                |                3 |
| TN                |               36 |
| Recall            |           96,97% |
| Precisione        |           93,20% |

Metriche per categoria:

| Categoria         | Recall | Precisione |
| ----------------- | -----: | ---------: |
| PERSON            | 95,08% |     98,31% |
| EMAIL_ADDRESS     |   100% |       100% |
| PHONE_NUMBER      |   100% |     72,73% |
| IT_FISCAL_CODE    |   100% |       100% |
| IT_VAT_CODE       |   100% |     85,71% |
| IBAN_CODE         |   100% |     88,89% |
| CREDIT_CARD       |   100% |     82,35% |
| IT_IDENTITY_CARD  |    75% |       100% |
| IT_DRIVER_LICENSE |    80% |       100% |

Il [bundle pubblicato](tests/evaluation/results/bardsai-v2-category-detection-2026-11-18/) conserva categorie e contatori senza testi, span o score.

## Memoria e performance

Protocollo locale di screening: Docker Desktop ARM64, limite 2 CPU, limite memoria 4.000.000.000 byte, workload fisso di 12 casi, stage da 15 secondi e campionamento ogni 500 ms.

### ONNX 1/1

Il throughput closed-loop raggiunge un plateau vicino a 8,7 risposte/s. Il massimo campionato di `memory.current` è circa 1.027 MiB e l'RSS del processo circa 1.085 MiB.

### ONNX 2/1

Il throughput closed-loop osservato è 13,47/14,93/15,13/15,07 risposte/s con 1/2/4/8 client. L'uso CPU medio sale da circa 0,97 a 1,92 core; `memory.current` resta circa 997 MiB e l'RSS circa 1.057 MiB. Lo stage open-loop più alto raggiunge il limite client e resta inconclusivo come misura isolata del servizio.

Il confronto mostra che il parallelismo intra-op incide materialmente sul throughput locale. La configurazione pubblicata resta 1/1 in assenza di soglie produttive e misure su un ambiente rappresentativo.

## Limiti

- Il golden copre 142 casi e non rappresenta tutti i testi reali.
- Gli screening risorse sono brevi e locali.
- Docker Desktop non espone `memory.peak`; i picchi riportati sono massimi campionati.
- Mancano soglie produttive ufficiali di memoria, latenza e throughput.
- `accepted` è un esito euristico, non una prova di assenza di dati personali.

## Verifiche tecniche

- test BardsAI: 14/14;
- contratto HTTP: 114 fixture sul solo servizio BardsAI;
- layout repository: solo BardsAI come detector;
- typecheck, ESLint, Prettier e `git diff --check`;
- prefetch offline, smoke locale e smoke Docker;
- test differenziale tra port TypeScript e snapshot ufficiale del decoder.
