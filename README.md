# Controllo dei dati personali nei campi liberi

**Scopo.** Valutare un controllo preventivo dei campi di testo libero: il servizio rileva categorie di dati personali, applica le categorie consentite per ciascun campo e restituisce un verdetto. Il confronto usa testi sintetici.
Il PoC horizon dovrà essere integrato con funzioni statiche per essere funzionalmente completo (nel poc c'è solo una funzione di controllo regex del CF italiano) rispetto a Presidio, ch einvece è calato perfettamente nel dominio di "burocrazia" italiana.

| PoC | Motore | Cartella |
| --- | --- | --- |
| Presidio | Python + spaCy italiano | [`poc-spacy/`](poc-spacy/) |
| Horizon | Node.js + Transformers.js/ONNX q8 + regola per il codice fiscale | [`poc-horizon/`](poc-horizon/) |

## Cosa valutano i team

| Team | Valutazione | Materiale |
| --- | --- | --- |
| **Infra** | Memoria e dimensione delle immagini, readiness, latenza cold/warm, bulk e burst, errori e comportamento sotto carico | [Runner e metriche](comparison/README.md), [prove di memoria](poc-horizon/README.md#misure-di-memoria) |
| **Business** | Categorie e verdetti attesi, falsi rifiuti e mancate rilevazioni, copertura e categorie consentite per campo | [Corpus annotato](comparison/corpus.json), [guida alla lettura](comparison/README.md#corpus-e-tassonomia) |

`rejected` indica una categoria rilevata e vietata per il campo; `accepted` indica un esito conforme alle soglie e alle categorie consentite configurate nel PoC. I casi del corpus hanno attese esplicite per categoria e verdetto. La [guida al confronto](comparison/README.md) spiega come leggere le differenze tra motori.

## Perché un'API HTTP

L'**API** mantiene stabile l'integrazione del chiamante **se** il servizio, anche tramite un adattatore per il nuovo modello, preserva protocollo HTTP, schema e significato delle categorie. `modelPolicyVersion` identifica la versione in uso. Questo permette di valutare nuovi modelli con lo stesso client e lo stesso corpus. Una **libreria nel processo chiamante** riduce il costo di trasporto, integrando runtime e risorse del detector nell'applicazione. Le valutazioni di Infra e Business guideranno la scelta di integrazione.

## Test e avvio

| Percorso | Contenuto |
| --- | --- |
| [`poc-spacy/tests/`](poc-spacy/tests/) | Test del motore Python |
| [`poc-horizon/tests/`](poc-horizon/tests/) | Test del motore Node.js |
| [`comparison/tests/`](comparison/tests/README.md) | Test del corpus, del contratto e del runner |
| [`comparison/corpus.json`](comparison/corpus.json) | Esempi sintetici e attese da esaminare con Business |
| [`comparison/run.mjs`](comparison/run.mjs) | Prova HTTP sui due container per Infra e Business |

Dalla root del repository (Python/`uv`, **Node.js ≥22**/`npm`):

```sh
(cd poc-spacy && uv sync --frozen --extra dev && uv run --frozen --extra dev pytest -q)
(cd poc-horizon && npm ci && npm test)
node --test comparison/tests/*.test.mjs
```

Per la prova end-to-end con Docker:

```sh
(cd poc-horizon && npm ci && npm run prefetch)
docker build -t free-text-check:spacy-poc ./poc-spacy
docker build -t free-text-check:horizon-poc ./poc-horizon
(umask 077; set -C; node comparison/run.mjs > "$HOME/poc-comparison-report.json")
```

## Metodo e risultati osservati

Il runner usa **39 campioni sintetici**: 18 coppie positivo/negativo, un caso neutro e due casi con categorie consentite. Due richieste HTTP per campione distinguono rilevamento e applicazione della policy. Ogni container ha **4 GiB di RAM e una quota di 2 CPU** (`--cpus=2`); Horizon usa la configurazione ONNX predefinita. Nella [prova Docker del 9 novembre 2026](comparison/README.md#risultato-della-prova-locale-9-novembre-2026), entrambi hanno completato 39/39 campioni con zero errori tecnici.

| Motore | Verdetti corretti | Falsi rifiuti | Mancati rifiuti | Latenza warm p50/p95 |
| --- | ---: | ---: | ---: | ---: |
| Presidio/spaCy | 27/39 | 10 | 2 | 5,92 / 10,29 ms |
| Horizon | 26/39 | 11 | 2 | 98,90 / 102,89 ms |

**Verifiche del 9 novembre 2026:** test del confronto 17/17, Horizon 16/16 e spaCy 18/18; smoke con il modello Horizon reale riuscito. I percentili warm in tabella derivano da una singola misura locale su cinque richieste per motore.

I verdetti corretti sono quelli attesi nel corpus annotato; la latenza warm riguarda cinque richieste successive alla prima richiesta HTTP dopo la readiness, misurata come cold. [Metodo, metriche e lettura dei risultati](comparison/README.md) approfondiscono il confronto. Il prefetch prepara il modello Horizon; conserva i report generati in un percorso privato e condividi soltanto aggregati autorizzati.
