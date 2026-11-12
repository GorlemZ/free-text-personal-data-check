"""Confine HTTP interno: risposte prive di testo, span e dettagli delle eccezioni."""

import json
import os
import re

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .analyzer import detect, get_analyzer
from .http_protocol import ExactTargetProtocol
from .policy import CATEGORIES, forbidden_categories, semantic_categories

# Unicode White_Space, non str.split(): U+001C..001F non sono separatori.
WORDS = re.compile(
    r"[^\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+"
)
MAX_BODY_BYTES = 1024 * 1024


class InvalidRequest(Exception):
    """Non trasporta dettagli dell'input."""


def _unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise InvalidRequest()
        obj[key] = value
    return obj


def _parse(body: bytes) -> list[dict]:
    payload = json.loads(
        body.decode("utf-8"),
        object_pairs_hook=_unique_object,
        parse_constant=lambda _: (_ for _ in ()).throw(InvalidRequest()),
    )
    if not isinstance(payload, dict) or set(payload) != {"fields"}:
        raise InvalidRequest()
    fields = payload["fields"]
    if not isinstance(fields, list) or not 1 <= len(fields) <= 10:
        raise InvalidRequest()
    ids = set()
    for field in fields:
        if (
            not isinstance(field, dict)
            or not {"fieldId", "text"} <= set(field)
            or not set(field) <= {"fieldId", "text", "allowedCategories"}
        ):
            raise InvalidRequest()
        field_id, text, allowed = (
            field["fieldId"],
            field["text"],
            field.get("allowedCategories", []),
        )
        if (
            not isinstance(field_id, str)
            or not 1 <= len(field_id.encode("utf-16-be")) // 2 <= 128
            or field_id in ids
            or not isinstance(text, str)
        ):
            raise InvalidRequest()
        if not isinstance(allowed, list) or any(
            not isinstance(category, str) or category not in CATEGORIES for category in allowed
        ):
            raise InvalidRequest()
        text.encode("utf-8")  # Rifiuta surrogate isolati anche nel testo.
        if sum(1 for _ in WORDS.finditer(text)) > 50:
            raise InvalidRequest()
        ids.add(field_id)
    return fields


def _error(status: int, code: str) -> JSONResponse:
    return JSONResponse(status_code=status, content={"code": code})


def create_app(*, detect_fn=None, ready_fn=None) -> FastAPI:
    """L'injection sostituisce risultati nativi, mai mapping o policy."""
    detector = detect if detect_fn is None else detect_fn
    readiness = get_analyzer if ready_fn is None else ready_fn
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.middleware("http")
    async def exact_route(request: Request, call_next):
        route = (
            request.method,
            request.scope.get("raw_request_target", request.scope.get("raw_path", b"")),
        )
        if request.scope.get("query_string") or route not in {
            ("GET", b"/health/ready"),
            ("POST", b"/v1/analyze"),
        }:
            return _error(404, "not_found")
        return await call_next(request)

    @app.get("/health/ready")
    def ready() -> JSONResponse:
        try:
            if readiness() is False:
                raise RuntimeError()
        except Exception:  # noqa: BLE001 - confine fail-closed, nessun dettaglio esportato
            return _error(503, "detector_unavailable")
        return JSONResponse(content={"status": "ready"})

    @app.post("/v1/analyze")
    async def analyze(request: Request) -> JSONResponse:
        if (
            request.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            != "application/json"
        ):
            return _error(400, "invalid_request")
        body = bytearray()
        try:
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_BODY_BYTES:
                    return _error(413, "body_too_large")
                body.extend(chunk)
            fields = _parse(bytes(body))
        except (InvalidRequest, ValueError, UnicodeError, RecursionError):
            return _error(400, "invalid_request")
        finally:
            body.clear()
        try:
            findings = set()
            for field in fields:
                categories = semantic_categories(field["text"], detector(field["text"]))
                for category in forbidden_categories(
                    categories, set(field.get("allowedCategories", []))
                ):
                    findings.add((field["fieldId"], category))
            return JSONResponse(
                content={
                    "verdict": "rejected" if findings else "accepted",
                    "findings": [
                        {"fieldId": fid, "category": cat}
                        for fid, cat in sorted(
                            findings,
                            key=lambda item: tuple(value.encode("utf-16-be") for value in item),
                        )
                    ],
                }
            )
        except Exception:  # noqa: BLE001 - confine fail-closed, nessun dettaglio esportato
            return _error(503, "detector_unavailable")

    return app


def serve() -> None:
    import uvicorn

    uvicorn.run(
        create_app(),
        host=os.environ.get("ANALYZER_BIND_HOST", "127.0.0.1"),
        port=int(os.environ.get("ANALYZER_PORT", "8000")),
        access_log=False,
        server_header=False,
        http=ExactTargetProtocol,
    )
