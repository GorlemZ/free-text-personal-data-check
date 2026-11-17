# Fonti dei casi esterni

Il corpus operativo è `gold.json`. I primi 91 casi conservano testo, annotazioni e provenienza precedenti. Le aggiunte del cohort `external-expansion-1` sono testi completi copiati senza normalizzazioni dai due artefatti sotto, con nuove annotazioni manuali per le nove categorie comuni. Nessun generatore viene eseguito dai test.

## Artefatti importati

| Fonte | Revisione fissata | Artefatto | Nuovi casi |
|---|---|---|---:|
| [Gretel — synthetic_pii_finance_multilingual](https://huggingface.co/datasets/gretelai/synthetic_pii_finance_multilingual) | `7b844d16738527a04264f50214cb426a4cea0897` | `data/Italian_test-00000-of-00001.parquet` | 30 |
| [mapo80 — AliasIT v5](https://huggingface.co/datasets/mapo80/aliasit-pii-dataset-v5) | `42ea279d8628775e2c3efb44b43b40b66b5968f5` | `data/test.parquet` | 30 |

Gli indici `provenance.row` sono zero-based. In ogni aggiunta sono presenti repository, revisione, percorso, split, hash del testo, annotazioni upstream e motivazione della selezione. Gli hash degli artefatti sono registrati in `sourceFiles`.

Gretel dichiara Apache-2.0. Il suo split `Italian_test` contiene anche XML, EDI e altri formati strutturati con etichette inglesi e nomi stranieri: il nome dello split non rende ogni riga prosa italiana. Alcune righe sono frammentarie già alla fonte; non sono state troncate o completate durante l'importazione. La selezione aggiunge contesti e casi limite, non prova rappresentatività dell'input di produzione.

AliasIT v5 dichiara **licenze miste**, ereditate dalle singole fonti. Le sue perturbazioni, ricostruzioni e traduzioni sono anteriori al nostro import: l'uguaglianza letterale riguarda il parquet v5, non il corpus originale sottostante. `upstreamTextReconstruction` e gli altri campi `upstream*` conservano questa distinzione. Le annotazioni di AliasIT possono essere derivate da altri modelli; le nostre categorie sono revisionate dal testo completo, non assunte corrette dalla label upstream.

## Attribuzione delle fonti selezionate tramite AliasIT

Credito per aggregazione e trasformazioni: **mapo80, AliasIT v5**. Le 30 righe selezionate derivano esclusivamente dalle seguenti fonti; esclusi Rizzo, DeepMount, fonti senza licenza dichiarata, documenti compositi e fonti reali.

| Credito e dataset | Revisione originale | Righe via v5 | Licenza dichiarata |
|---|---|---:|---|
| [Ai4Privacy / Ai Suisse SA — OpenPII 1M](https://huggingface.co/datasets/ai4privacy/pii-masking-openpii-1m) | `ecfdc547f4a0955600cfe6ab98ba2a162207fcc0` | 15 | CC-BY-4.0; Copyright © 2026 Ai Suisse SA |
| [KlusAI — ds-kp-general-it-50k](https://huggingface.co/datasets/klusai/ds-kp-general-it-50k) | `1f46211fd5ba203c0071a5885d09965068a3d627` | 2 | CC-BY-4.0 |
| [E3-JSI — synthetic-multi-pii-ner-v1](https://huggingface.co/datasets/E3-JSI/synthetic-multi-pii-ner-v1) | `2fe1b17ea2d82d80b2570e5c48c416a3b317828f` | 5 | MIT |
| [urchade — synthetic-pii-ner-mistral-v1](https://huggingface.co/datasets/urchade/synthetic-pii-ner-mistral-v1) | `392d6853aaec28075253565350e0d17b9e0ffc0d` | 5 | Apache-2.0 |
| [kurkowski — synthetic-contextual-anonymizer-dataset](https://huggingface.co/datasets/kurkowski/synthetic-contextual-anonymizer-dataset) | `4b3170d51764950fb6b68841ab33a70ec853348a` | 3 | MIT |

Le schede originali alle revisioni indicate sono state consultate. OpenPII usa `license: other` nei metadati, ma `license_name: cc-by-4.0` e la sezione *Licensing and Terms of Use* specificano CC-BY-4.0, attribuzione e uso commerciale. Non si applicano le condizioni del diverso dataset `pii-masking-300k`. La tabella di AliasIT omette l'obbligo di attribuzione per alcune fonti: qui vengono accreditate comunque tutte le fonti effettivamente utilizzate.

Riferimenti alle condizioni: [CC-BY-4.0](https://creativecommons.org/licenses/by/4.0/), [testo Apache-2.0](licenses/Apache-2.0.txt), [avviso MIT](licenses/MIT.txt). I repository sorgente MIT alle revisioni indicate dichiarano la licenza nella scheda e non contengono un distinto file LICENSE/NOTICE; non viene inventato un anno di copyright. Questa attribuzione non implica approvazione degli autori al confronto.

## Modifiche, privacy e annotazioni

- Testi conservati esattamente; annotazioni rimappate/revisionate e policy assegnate localmente. Le annotazioni upstream restano come provenienza, non come verità automatica.
- Le fonti dichiarano dati sintetici; non è dimostrato che ogni valore sia non assegnato nel mondo reale. Non sono stati cercati contatti o identità reali e non viene dichiarata una garanzia di anonimato.
- `unknown` indica una categoria non determinabile dal testo, non un errore del detector. Le coppie incerte non entrano nelle matrici detection; una policy indeterminata è esclusa dalle metriche di verdetto. Il dettaglio per caso è in `review.note` e [REVIEW.md](REVIEW.md).
- Hash e fingerprint non attestano indipendenza statistica. Le famiglie includono template correlati, frammenti e ricostruzioni; nessuna garanzia di assenza dal training dei tre motori.
- L’importazione è avvenuta prima delle nuove predizioni. Il run corrente è in `results/main-2026-11-17/`; `results/uniform-http/` conserva invece il pilot storico a 91 casi.
