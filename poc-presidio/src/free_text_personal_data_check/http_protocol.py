"""Conserva il request-target HTTP: ASGI standard perde il delimitatore '?' vuoto."""

from typing import cast

import h11
from uvicorn.protocols.http.h11_impl import H11Protocol


class ExactTargetProtocol(H11Protocol):
    """Hook locale alla connessione; nessuna modifica globale a uvicorn/h11.

    Uvicorn crea lo scope e schedula il task ASGI dentro handle_events.
    Annotiamo quello stesso scope prima che il callback sincrono restituisca
    il controllo all'event loop. Il parsing/framing resta interamente a h11.
    """

    def handle_events(self) -> None:
        next_event = self.conn.next_event
        target = None

        def observe_event():
            nonlocal target
            event = next_event()
            if isinstance(event, h11.Request):
                target = event.target
            return event

        self.conn.next_event = observe_event
        try:
            super().handle_events()
        finally:
            self.conn.next_event = next_event
        if target is not None and self.scope is not None:
            cast(dict, self.scope)["raw_request_target"] = target
