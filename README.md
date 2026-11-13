# Controllo dei dati personali nei campi liberi

Stato al 12 novembre 2026.

## Stato attuale

Tre prototipi (PoC) confrontano il riconoscimento di dati personali nei testi liberi. Usano la stessa interfaccia e le stesse regole: per ogni campo si indicano i dati consentiti; se il sistema rileva altri dati personali, li segnala e rifiuta la richiesta.

| PoC | Come riconosce i dati |
|---|---|
| Rizzo | Modello addestrato sui dati personali, con regole aggiuntive |
| Horizon | Un altro modello, più compatto, con regole aggiuntive |
| Presidio | Libreria di riconoscimento con un modello per la lingua italiana |

L'elaborazione avviene localmente. Rizzo e Horizon usano JavaScript; Presidio usa Python.

## Come siamo arrivati qui

Abbiamo reso confrontabili tre implementazioni diverse, uniformando interfaccia, categorie considerate e regole per campo. Rizzo e Horizon ora eseguono i modelli con la stessa libreria, Transformers.js, conservando i rispettivi modelli e criteri di riconoscimento.

Abbiamo poi verificato le risposte su esempi con risposta attesa nota e misurato la memoria in ambienti separati.

## Accuratezza

Sul campione esteso di **151 casi, con 142 testi distinti**, 98 richieste dovevano essere rifiutate e 53 accettate. Misuriamo la decisione finale di accettare o rifiutare.

| PoC | Decisioni corrette | Accettate per errore (su 98) | Rifiutate per errore (su 53) |
|---|---:|---:|---:|
| Rizzo | 88,7% | 6 | 11 |
| Horizon | 87,4% | 14 | 5 |
| Presidio | 78,8% | 20 | 12 |

Rizzo lascia passare meno casi da bloccare; Horizon riduce i falsi allarmi.

Abbiamo ricontrollato Rizzo e Horizon dopo l'allineamento; per Presidio riportiamo il test precedente sullo stesso campione. Il campione è di sviluppo e contiene casi simili: servono prove su testi rappresentativi del servizio.

## Memoria

Rizzo e Horizon hanno completato il test aggiornato con **4 GB disponibili e 30 richieste ciascuno**. Per Presidio riportiamo la misura precedente, con un carico diverso.

| PoC | Massimo di RAM osservato | Esito |
|---|---:|---|
| Rizzo | Circa 4,00 GB | Vicino al limite; nella prova a 2 GB l'avvio non è stato completato |
| Horizon | Circa 2,36 GB | Test a 4 GB completato |
| Presidio | Circa 0,16 GB | Molto più leggero nella misura precedente |

I valori includono l'intero ambiente isolato (container) e sono massimi campionati in prove brevi e con carichi diversi. **Il requisito di 2 GB per container resta da dimostrare.** Per l'uso continuativo servono verifiche più lunghe.

## Guide e utilizzo

- PoC: [Rizzo](poc-rizzo/README.md), [Horizon](poc-horizon/README.md), [Presidio](poc-presidio/README.md).
- [Installazione e test](tests/README.md).
- [Interfaccia comune](tests/contract/README.md).
- [Metodo e limiti dei test sulle risorse](tests/resources/README.md).

I PoC sono per prove locali con dati di test. Prima dell'integrazione servono accessi controllati, rete protetta e regole sui dati consentiti definite da una fonte fidata. Alcuni dati personali possono sfuggire anche con un esito di accettazione.
