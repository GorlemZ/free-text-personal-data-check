# Audit indipendente resource-stress

**Esito: 1 P2 sulla qualificazione/strumentazione CPU; nessuna P1. Coerenza del resto del bundle PASS.**

## P2 — timestamp del contatore CPU non allineato
`telemetry.py:234-239,364,403-412` legge l’uptime a BEGIN, poi vari file memoria e infine cpu.stat. Il delta usage è diviso per il delta BEGIN, non per gli istanti di acquisizione del contatore. Il report (`run.py:693`) non rende esplicito questo errore potenziale di finestra nei massimi.

- Rizzo: 2.750848 CPU-secondi / 1.06 s = 2.5951396 core; frame precedente 0.01 s, corrente 0.43 s. Gli istanti possibili del contatore consentono una media fra 1.8462 e 2.6199 core (prima della quantizzazione uptime).
- Horizon: 2.297701 / 1.01 = 2.2749515 core; frame 0.21 / 0.42 s, intervallo compatibile 1.6068–2.8721 core.
- La formula è aritmeticamente corretta e identica al raw. È confermato il disallineamento della misura, NON una violazione reale della quota, né che tutti i superamenti derivino dal timing. Burst di scheduler sono plausibili in principio ma non dimostrati qui; mancano timestamp precisi di cpu.stat, cpu.max.burst e nr_periods. La quota campionata è sempre 200000/100000.
- Correzione suggerita, non eseguita: timestamp prima/dopo cpu.stat e durata acquisizione; segnalare intervalli incerti e qualificare i massimi storici. Non troncare a due core.

## Verifiche PASS
- **4 artefatti**, non 6: results.json, stages.csv, samples.csv, report.md. Rerender offline effettivo con sink in memoria associati a scratch, confronto bytewise identico per tutti. Nessuna cartella di output aggiuntiva creata per rispettare i soli due file autorizzati; non è un test del percorso CLI/filesystem.
- 20 stage, 192 sample, 7489 osservazioni. Conteggi, completamenti window/drain, throughput, p50/p95 nearest-rank, error latency e mix/volume ricostruiti indipendentemente e coerenti.
- Rizzo: 162 tentativi, 154 successi, 2 timeout, 6 cancellazioni; a 8 client 23 tentativi, 15 successi e gli 8 esiti precedenti. Stop server_drain_unknown.
- Horizon: 250 tentativi, 164 successi, 84 HTTP error, 2 cancellazioni; a 8 client 114 tentativi, 25 successi nella finestra e 3 nel drain, 84 errori e 2 cancellazioni. Stop budget_cancelled, transizioni complessive 5.004610917 s contro budget 5 s.
- Presidio: 7077 tentativi, tutti successi. Primo candidato plateau 4, confermato a 4: TV coppia 0.00758550, TV conferma 0.01513780; throughput 123.2 → 122.2 → conferma 124.4 req/s. Solo diagnostica preliminare.
- Rizzo candidato 2, Horizon candidato 4: entrambi non confermati; degradation_observed=true preservato. Horizon 1→2 escluso per TV=0.1142857.
- RAM: RSS, memory.current, anon, file, shmem e kernel non sommati; memory_peak e kernel assenti in tutti i campioni e lasciati null. Disk: image/modelli/cache sovrapposti esplicitamente; post-disk Rizzo/Horizon non misurato, non zero. Presidio writable layer 20387 byte, separato.
- Protocollo partial, elapsed 196.002475875 s; solo Presidio completo. Exit 2 coerente col codice, non rieseguito. Tutti i collector arrestati e cleanup true; docker ps live read-only restituisce zero container in esecuzione.
- Gold effettivo: `free-text-personal-data-check-node-spike/tests/evaluation/gold.json`, hash `9f7232b4532cabd376987d1cb11b32735c062e5861f5d18b77e4d4eab7ebec0f`. Identico al receipt, ordine e metadati verificati. NON è il gold del repo auditato, che ha hash differente; non è una regressione del run.

## Limiti e scritture
Solo i due file scratch resource-stress-audit.json/md; nessuna modifica repo, nuovo container, build o inferenza. Nessuna review del corpus. Le suite parent 23+26 non sono state rieseguite. JSON contiene gli hash dei quattro originali e le evidenze aggregate. Documentazione primaria scheduler consultata: kernel.org, CFS Bandwidth Control v5.14; estrazione diretta non disponibile, ricerca alternativa riuscita.
