# Progress — PoC Horizon/spaCy

## Sessione 2026-11-04
- Phase 1 complete: verificati checkout remoto/locale, sorgenti Python, metadata Horizon, versione pacchetto JS.
- Phase 2 complete: due review rapide indipendenti; aggiunti smoke reale prima del servizio, manifest e boot offline, contratto e label map, budget token, metriche anon/file-cache e criterio bounded.
- Phase 3 complete: software storico spostato senza modifiche in `poc-spacy/`; Node PoC con modello ONNX q8 locale in `poc-horizon/`; smoke reale host (EMAIL e coda rilevate, >512 token respinti), test unitari 7/7, benchmark sintetico eseguito. Docker immagini costruite e smoke offline riuscito; ottimizzato Dockerfile eliminando `chown` che duplicava ~1,17 GB di layer. Suite wire condivisa 6 casi su entrambe le immagini: PASS.
- Phase 4 in progress: primo probe esplorativo con bassa diversità lessicale (spaCy 2×1000, memoria quasi piatta ma input poco innovativi); generatore aggiornato per inserire 16/32/40 token artificiali **nuovi per richiesta**. Primo tentativo Horizon in parallelo a build/spaCy/smoke interrotto dal daemon Docker Desktop scomparso: non è un OOM attribuibile al container. Un successivo run Horizon 1×1000 ha avuto 30 risposte tecniche perché 30 input lunghi erano >512 token (verificato contando i token localmente); i 503 non vanno interpretati come guasto della cache. Ridotte le pseudo-parole lunghe a 40 e verificato con il tokenizer che il massimo per le 232 richieste lunghe è 481 token. Secondo run errato interrotto volontariamente e container residuo rimosso. Le serie definitive su immagine ricostruita con limite 4 GiB sono in corso senza prove pesanti parallele.
- Phase 5 in progress: review avversariale rapida post-implementazione ha individuato 3 problemi; corretto decoding UTF-8 con TextDecoder fatal e test, reso esplicito il conteggio sulle categorie condivise nel benchmark, aggiunto runner wire reale per le due immagini; il probe ora ispeziona il container in caso di interruzione prima del cleanup per riferire OOM/exit quando il daemon è disponibile.
- Errore: PWF init prima della creazione della directory ha dato FileNotFoundError; corretto usando `cwd` dopo `mkdir -p`.
- Errore: una chiamata `execute_code` per calcolare hash dei tre piccoli file modello è stata bloccata senza consenso: non ritentata. Manifest usa SHA256 pubblicati dal Hub per i due file LFS grandi e revision+size per gli altri.
- Errore: `rtk uv run` avviato in background ha fallito lo spawn; rilanciato in foreground: 18 test Python passati, Ruff check/format passati.

## Verifiche
| Verifica | Risultato |
|---|---|
| `git ls-remote origin refs/heads/main` | SHA locale/remoto coincidenti |
| Hub API file e label | modello ONNX quantizzato presente; labels verificate |
| Test Python | 18 passed; Ruff check e format OK |
| Test Node | 7 passed; smoke reale e smoke offline OK |
| Contratto HTTP comune | 6 check su entrambe le immagini: PASS |
| Benchmark sintetico | 10 esempi per implementazione; Horizon categorie comuni 2 TP/0 FN, 1 categoria attesa non supportata; spaCy 3 TP/2 FP nel set a 8 categorie |
| Docker | immagini costruite; dimensioni e prove sotto |

## Probe memoria finale — 4 GiB, swap disabilitato, 1 processo/container

Ogni serie: container nuovo, warmup 20 richieste, poi 1.000 input sintetici diversi (256 brevi, 512 medi, 232 lunghi), 16/32/40 pseudo-parole inedite per richiesta; 4 client nell'ultimo 10%, inferenza Horizon seriale. Sono misure **campionate**, non massimi assoluti. `memory.peak` non disponibile. `anon` e `file` dal cgroup distinguono in parte heap/arena da page cache; la heap V8 non è misurata separatamente. Il criterio permissivo `indicativePlateau` è `true` nelle 4 serie, ma può nascondere deriva lenta.

| Motore | Serie | RSS MiB 0 / 250 / 500 / 750 / 1000 | `memory.current` MiB 0 / 250 / 500 / 750 / 1000 | Errori/OOM | p50/p95 HTTP ms |
|---|---:|---|---|---|---|
| Horizon | 1 | 1340,4 / 1601,1 / 1532,8 / 1532,1 / 1556,7 | 1281,5 / 1543,1 / 1471,6 / 1471,1 / 1496,0 | 0/false | 467,7 / 2301,6 |
| Horizon | 2 | 1357,6 / 1602,5 / 1533,6 / 1533,1 / 1556,9 | 1298,3 / 1543,8 / 1472,0 / 1471,4 / 1495,8 | 0/false | 435,3 / 2698,5 |
| spaCy | 1 | 177,5 / 178,3 / 180,6 / 182,4 / 184,9 | 146,5 / 147,0 / 149,4 / 151,2 / 153,9 | 0/false | 12,3 / 68,7 |
| spaCy | 2 | 177,5 / 178,3 / 180,6 / 182,4 / 185,0 | 146,3 / 146,8 / 149,2 / 151,0 / 153,6 | 0/false | 12,0 / 71,3 |

Horizon mostra una salita iniziale fino a 250 e poi un livello comparabile nelle due serie: fra 500 e 1000 RSS +23,9/+23,3 MiB (~1,5%), coerente con il passaggio a testi lunghi a 768; sulla fascia di lunghezza media 500→750 è quasi piatto. spaCy mostra aumento RSS monotono: +4,3/+4,4 MiB fra 500 e 1000, nonostante un valore assoluto molto minore. Questi dati **non provano** limite superiore della cache Horizon né crescita illimitata spaCy: durata e forme di input sono limitate. Il `file` campionato nelle serie definitive è ~0–0,2 MiB; in uno smoke preliminare Horizon la page cache era ~728,5 MiB, quindi `memory.current` è sensibile allo stato dell'host. Limite 4 GiB scelto per il PoC; non è una raccomandazione di sizing.

Dimensione immagine Docker: Horizon 1.582.037.336 byte (~1508,7 MiB), spaCy 847.664.619 byte (~808,4 MiB). La dimensione immagine NON è il consumo RAM.

### Limitazioni e anomalie
- Primo tentativo parallelo: Docker Desktop ha perso il daemon; impossibile attribuire un OOM al container, stato non verificabile al momento del guasto.
- Run Horizon precedente con 48 pseudo-parole lunghe: 30 richieste superavano 512 token e ricevevano 503; misurato con tokenizer (max 553). Ridotti a 40, max misurato 481 token, tutte le 2×1000 richieste definitive hanno risposto 200.
- Il generatore definitivo emette pseudo-parole sintetiche; non rappresenta distribuzione reale. Le 4 richieste in burst non dimostrano analisi concorrente: Horizon serializza, spaCy esegue detect sincrono nell'endpoint async.
- `memory.peak` assente; il valore massimo di RSS nei checkpoint non è un picco assoluto. La prova non dimostra sicurezza a 256 MiB o idoneità produttiva.
