# Confronto funzionale — gold unico

Il solo gold corrente è `corpus.json`, con configurazione, provenienza, conteggi derivati e hash in `manifest.json`. **Review indipendente pending**: i controlli automatici non equivalgono a una review. Nessun benchmark dei detector è stato eseguito per questa migrazione. I report storici esterni a questa cartella restano storici e non descrivono questo gold.

## Corpus e tassonomia

Catalogo: `PERSON`, `EMAIL_ADDRESS`, `PHONE_NUMBER`, `IT_FISCAL_CODE`, `IT_VAT_CODE`, `IBAN_CODE`, `CREDIT_CARD`.

- PERSON è contestuale; organizzazioni, luoghi e parole ambigue non sono automaticamente persone.
- PHONE_NUMBER: qualsiasi paese con prefisso esplicito `+`/`00`; senza prefisso, default IT. Validità dei metadati e confini dell'intero candidato, senza recuperare sottostringhe di candidati malformati.
- CF canonico con checksum; omocodia fuori perimetro.
- P.IVA: checksum, 11 cifre, prefisso `IT` compatto opzionale; tutte zero negativo.
- IBAN italiano: mod97, spazi ASCII opzionali; nessuna verifica di CIN domestico o assegnazione.
- Carta: 13–19 cifre, Luhn, spazi ASCII/trattini. Nessuna prova di emittente o assegnazione.

Il corpus include checksum falliti, confini Unicode, distrattori delle categorie rimosse, combinazioni e allowlist complete/parziali. `expectedEntities` elenca tutte le categorie target, non solo `focusCategory`. I valori sono sintetici, ma non se ne può garantire la non assegnazione: non chiamare numeri né tentare transazioni. Domini example sono usati come testo. Le regole complete sono in `manifest.json.policy`.

## Verifica senza inferenza e senza Docker

Dalla root:

```sh
node --test comparison/tests/*.test.mjs
node comparison/functional/run.mjs --validate-only
```

La seconda istruzione usa solo il tokenizer locale Horizon, senza pesi né inferenza. Richiede dipendenze e asset tokenizer già disponibili. `generate-gold.py` rigenera **sovrascrivendo** corpus e manifest e riporta la review a pending; richiede `phonenumbers` nell'ambiente Python di spaCy. I test verificano schema, digest, checksum con un'implementazione indipendente, HTTP simulato, metriche e report: non misurano l'accuratezza dei modelli.

## Configurazione e gate di esecuzione

`functional/capabilities.json` è configurazione esplicita, legata tramite SHA-256 al manifest: mapping, categorie, versione attesa di policy per motore, digest immagine e stato di allineamento. Le versioni non sono costanti nel runner. Allineamento **pending** e digest immagini `null` bloccano l'esecuzione, non la validazione strutturale.

Prima di un run autorizzato: completare la review indipendente del gold (righe e manifest, reviewer/data), verificare le implementazioni, aggiornare le versioni attese e i digest immagini nella configurazione, registrarne il nuovo hash nel manifest e marcare l'allineamento verificato. Un hash garantisce integrità rispetto alla configurazione, non prova da solo autenticità o review. Il runner confronta versione sorgente, versione delle risposte, registry attivo Presidio e immagine realmente avviata con la configurazione. Non eliminare questi gate per far passare un run.

Solo dopo tali gate e autorizzazione:

```sh
node comparison/functional/run.mjs --presidio-image <immagine-p> --horizon-image <immagine-h> --output-dir <nuova-cartella>
```

Il runner isola i container con rete interna, bind loopback, 2 CPU e 4 GiB senza swap; verifica egress e readiness e pulisce le sole risorse proprie. Non crea immagini né scarica modelli. Per ri-renderizzare un bundle sanitizzato:

```sh
node comparison/functional/run.mjs --render <results.json> --output-dir <nuova-cartella>
```

Il render è autonomo dal corpus: verifica integrità e schema del bundle, non certifica che un manifest esterno sia autentico o approvato. Non sovrascrive una directory risultati esistente.

## Metriche e riservatezza

Una detection probe per testo distinto, con allowlist vuota; ogni riga conserva una policy probe separata. Non duplicare detection per le varianti allowlist. Denominatori indipendenti per probe, motore e cohort own/paired: un errore policy non cancella una detection riuscita e viceversa. Errori tecnici/contrattuali e unità non tentate restano espliciti; divisioni con denominatore zero sono null/N/A. Extra label native sono diagnostiche, non nuove categorie target, e possono incidere sul verdetto applicativo.

Il collector condiviso produce solo ID sintetici, categorie, stati, verdetti e metadati consentiti. Non salva testo, span, body HTTP o motivazioni libere nelle evidenze. I risultati sono development correlati, non held-out né stime della prevalenza produttiva. `accepted` non dimostra assenza di dati personali.
