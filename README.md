# Controllo dei dati personali nei campi liberi

Tre PoC locali per confrontare il riconoscimento di dati personali e la policy per campo attraverso **la stessa API HTTP e lo stesso catalogo di nove categorie**. La valutazione usa testi sintetici. È uno spike funzionale: prestazioni, memoria, latenza e concorrenza sono rinviate.

| Cartella | Contenuto |
|---|---|
| [`tests/`](tests/) | Suite automatiche, contratto HTTP condiviso, unico pilot annotato e runner comparativo |
| [`poc-horizon/`](poc-horizon/) | Node.js, modello Horizon ONNX e riconoscitori strutturati |
| [`poc-rizzo/`](poc-rizzo/) | Node.js, modello Rizzo ONNX e regole TypeScript |
| [`poc-presidio/`](poc-presidio/) | Python, Presidio e spaCy italiano |

I container Horizon e Rizzo eseguono la detection nel processo Node e non richiedono Python. Presidio rimane un servizio Python separato. Pesi e cache locali non vengono versionati.

## Contratto comune

[Specifica HTTP e fixture condivise](tests/contract/README.md).

```http
POST /v1/analyze
Content-Type: application/json
```

```json
{"fields":[{"fieldId":"descrizione","text":"Vorrei informazioni.","allowedCategories":[]}]}
```

```json
{"verdict":"accepted","findings":[]}
```

In caso di rifiuto, `findings` contiene soltanto coppie `fieldId`/`category`. Mai testo, dati estratti, span, score o metadati del motore.

- Da 1 a 10 campi, massimo 50 unità separate da Unicode `White_Space` per campo.
- Categorie: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`, `IT_IDENTITY_CARD`, `IT_DRIVER_LICENSE`.
- `allowedCategories` omessa o vuota: tutte le categorie sono vietate.
- I servizi proiettano le categorie native nel catalogo comune **prima della policy**: luoghi, date e altri extra conosciuti non provocano rifiuti.
- Errori di input e tecnici sono distinti dai verdetti; un'analisi incompleta non diventa `accepted`.

API e policy uguali consentono di confrontare i servizi. Modelli, soglie e riconoscitori restano differenti. Il gold considera riconoscibili anche gli identificativi con checksum errato; eventuali filtri di validità del motore possono quindi produrre falsi negativi misurati. `accepted` non certifica l'assenza di dati personali.

## Installazione e test

Dalla root, con Node.js 24, npm, Python e `uv`:

```sh
npm --prefix poc-rizzo ci
npm --prefix poc-horizon ci
uv sync --project poc-presidio --frozen --extra dev
python3 tests/run.py
```

Le suite sono centralizzate in `tests/rizzo`, `tests/horizon`, `tests/presidio`, `tests/evaluation/tests` e `tests/contract`. È possibile eseguirle singolarmente, ad esempio `python3 tests/run.py rizzo`. I test unitari e del protocollo non richiedono i pesi dei modelli. Le fixture di protocollo sostituiscono l'output nativo prima del vero adapter: non sono misure della qualità di detection.

## Modelli e container

```sh
npm --prefix poc-rizzo run prefetch
npm --prefix poc-horizon run prefetch

docker build -t free-text-check:rizzo-uniform ./poc-rizzo
docker build -t free-text-check:horizon-uniform ./poc-horizon
docker build -t free-text-check:presidio-uniform ./poc-presidio
```

Ogni build usa il proprio contesto, senza il worktree fratello o i vecchi percorsi. I manifest fissano gli artefatti ONNX; il PoC Presidio documenta le dipendenze e il modello spaCy.

Esempio di avvio locale, senza autenticazione:

```sh
docker run --rm -p 127.0.0.1:18081:8000 free-text-check:rizzo-uniform
docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0 -p 127.0.0.1:18082:8000 free-text-check:horizon-uniform
docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0 -p 127.0.0.1:18083:8000 free-text-check:presidio-uniform
```

Usare terminali separati; attendere `GET /health/ready` su ciascun servizio. Pubblicare solo su loopback. I dettagli operativi dei singoli PoC sono nei rispettivi README.

## Risultato del pilot del 12 novembre 2026

**546/546 richieste riuscite**, senza errori tecnici o contrattuali: 91 casi, 82 testi distinti, stesso catalogo e policy interna per tutti e tre i servizi. Positivo = richiesta da rifiutare; FN = falsa accettazione, FP = falso rifiuto.

| Motore | TP / TN / FP / FN | Sensibilità | Precisione | Accuracy | Balanced accuracy |
|---|---:|---:|---:|---:|---:|
| Rizzo | 61 / 22 / 3 / 5 | 92,42% | 95,31% | 91,21% | 90,21% |
| Horizon | 54 / 24 / 1 / 12 | 81,82% | 98,18% | 85,71% | 88,91% |
| Presidio | 51 / 20 / 5 / 15 | 77,27% | 91,07% | 78,02% | 78,64% |

Il gold prevedeva 66 rifiuti e 25 accettazioni. Questi sono verdetti osservati via HTTP, non ricostruiti dal runner. Il campione è piccolo, correlato e non heldout: la tabella descrive questo pilot, senza dimostrare superiorità generale. Nessun tuning dopo le predizioni.

[Report per categoria, fonte e copertura](tests/evaluation/results/uniform-http/report.md) · [Contesto di esecuzione e hash](tests/evaluation/results/uniform-http/run-context.json) · [Audit indipendente: PASS](tests/evaluation/results/uniform-http/audit.md).

## Valutazione funzionale

[Metodo, comandi, provenance e risultati](tests/evaluation/README.md).

Il pilot unico conserva i testi Rizzo/Gretel e i casi mirati precedenti, integrati con una selezione del vecchio gold italiano. Gli import sono riannotati secondo il goal corrente: le vecchie etichette non sono assunte corrette. La cartella `comparison/` e i runner precedenti sono rimossi; il contenuto storico non selezionato resta recuperabile da Git.

Per ogni caso e motore il runner esegue due vere richieste HTTP: una deny-all per misurare la presenza delle categorie e una con la policy prevista. Le metriche sono separate per categoria, verdetto e origine. Unknown, errori tecnici e copertura sono dichiarati; i confronti appaiati usano gli stessi casi completati da tutti e tre i servizi.

Il campione è piccolo e parte dei testi è già stata valutata; i dati Rizzo condividono provenienza con il modello. I risultati sono descrittivi, non un test indipendente rappresentativo della produzione. Gli snapshot storici a cataloghi diversi restano esplicitamente separati dal nuovo confronto.
