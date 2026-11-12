# PoC Presidio

Servizio FastAPI/Uvicorn con Presidio Analyzer e spaCy italiano `it_core_news_sm` 3.8.0. [Contratto HTTP comune](../tests/contract/README.md) · [Test](../tests/README.md) · [Valutazione](../tests/evaluation/README.md).

## Avvio dalla root

Richiede Python 3.11–3.12 e `uv`; dipendenze e modello italiano sono fissati in `uv.lock`.

```sh
uv sync --project poc-presidio --frozen --extra dev
uv run --project poc-presidio --frozen free-text-check
```

Bind predefinito `127.0.0.1:8000`, configurabile con `ANALYZER_BIND_HOST` e `ANALYZER_PORT`; access log disabilitato. La readiness verifica il caricamento del modello.

```sh
docker build -t free-text-check:presidio-uniform ./poc-presidio
docker run --rm -e ANALYZER_BIND_HOST=0.0.0.0   -p 127.0.0.1:18083:8000 free-text-check:presidio-uniform
```

Attendere `GET /health/ready`. Il runtime usa un utente non privilegiato e contiene soltanto il servizio. Il bind interno consente la pubblicazione della porta; sul computer host l'accesso resta su loopback. Per altre esposizioni servono controllo degli accessi e protezione di rete.

## Detection e adattamento

- NER italiano `PER`/`ORG`/`LOC`, soglia `0.35`, riconoscitori predefiniti e relativi checksum. Il filtro business valida i risultati nativi prima di escludere gli extra conosciuti; label nuove o output malformati causano errore tecnico.
- I documenti italiani usano le label native `IT_*`. I documenti esteri generici restano esclusi dalle categorie italiane.
- `PHONE_NUMBER` richiede un involucro numerico completo compatibile con telefono italiano: mobile `3` e altre nove cifre oppure fisso `0`, cifra non zero e altre 4–9 cifre; prefissi `+39`/`0039` ammessi. Il filtro esclude prefissi esteri e sottostringhe di token più lunghi, senza creare detection mancanti.
- I gate di validità del motore possono perdere identificativi riconoscibili con checksum errato: il pilot li conta come falsi negativi.
- L'email validator usa il Public Suffix List incluso nel pacchetto, senza fetch runtime.

## Dettagli di protocollo

`ExactTargetProtocol` conserva il delimitatore di query vuoto `?`, perso dallo scope ASGI standard, per applicare il routing esatto. Il conteggio parole usa Unicode `White_Space`: `str.split()` includerebbe anche U+001C–U+001F. `allowedCategories` è una policy di categorie per campo, distinta dalla `allow_list` di valori di Presidio.

Le [utility diagnostiche](../tests/README.md#utility-diagnostiche) sono esterne al package e all'immagine runtime.
