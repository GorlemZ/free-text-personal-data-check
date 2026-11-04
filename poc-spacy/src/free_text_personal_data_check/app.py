"""Internal HTTP boundary. Never serialize user text or raw exceptions."""

import json
import os

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from .analyzer import MODEL_POLICY_VERSION, detect, get_analyzer
from .policy import forbidden_categories

MAX_BODY_BYTES = 32_768
MAX_FIELDS = 16
MAX_FIELD_CHARS = 2_000
MAX_FIELD_BYTES = 8_000
FIELD_IDS = frozenset(
    {
        "description",
        "contactName",
        "serverUrls[].description",
        "eserviceName",
        "eserviceDescription",
        "intendedTarget",
        "purposeDescription",
        "freeOfChargeReason",
        "riskAnalysisAnswer",
        "consumerNotes",
        "rejectAgreementReason",
    }
)


class InvalidRequest(Exception):
    """No payload or user-supplied detail is carried on this exception."""


def _unique_object(pairs):
    obj = {}
    for key, value in pairs:
        if key in obj:
            raise InvalidRequest()
        obj[key] = value
    return obj


def _parse(body: bytes, categories: set[str]) -> list[dict]:
    try:
        payload = json.loads(body, object_pairs_hook=_unique_object)
    except (ValueError, UnicodeError):
        raise InvalidRequest() from None
    if not isinstance(payload, dict) or set(payload) != {"fields"}:
        raise InvalidRequest()
    fields = payload["fields"]
    if not isinstance(fields, list) or not 1 <= len(fields) <= MAX_FIELDS:
        raise InvalidRequest()
    ids = set()
    for field in fields:
        if not isinstance(field, dict) or set(field) != {"fieldId", "text", "allowedEntityTypes"}:
            raise InvalidRequest()
        field_id, text, allowed = (field[k] for k in ("fieldId", "text", "allowedEntityTypes"))
        if not isinstance(field_id, str) or field_id not in FIELD_IDS or field_id in ids:
            raise InvalidRequest()
        ids.add(field_id)
        if (
            not isinstance(text, str)
            or len(text) > MAX_FIELD_CHARS
            or len(text.encode("utf-8")) > MAX_FIELD_BYTES
        ):
            raise InvalidRequest()
        if (
            not isinstance(allowed, list)
            or len(allowed) > len(categories)
            or any(not isinstance(x, str) or x not in categories for x in allowed)
            or len(set(allowed)) != len(allowed)
        ):
            raise InvalidRequest()
    return fields


def create_app() -> FastAPI:
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)

    @app.get("/health/ready")
    def ready() -> JSONResponse:
        try:
            get_analyzer()
        except Exception:  # noqa: BLE001 - fail closed without exposing input or exception
            return JSONResponse(status_code=503, content={"code": "ANALYZER_UNAVAILABLE"})
        return JSONResponse(content={"status": "ready"})

    @app.post("/v1/analyze")
    async def analyze(request: Request) -> JSONResponse:
        body = bytearray()
        try:
            async for chunk in request.stream():
                if len(body) + len(chunk) > MAX_BODY_BYTES:
                    raise InvalidRequest()
                body.extend(chunk)
            if request.headers.get("content-type", "").split(";", 1)[0] != "application/json":
                raise InvalidRequest()
            engine = get_analyzer()
            fields = _parse(bytes(body), set(engine.get_supported_entities(language="it")))
        except InvalidRequest:
            return JSONResponse(status_code=400, content={"code": "INVALID_ANALYZE_REQUEST"})
        except Exception:  # noqa: BLE001 - fail closed without exposing input or exception
            return JSONResponse(status_code=503, content={"code": "ANALYZER_UNAVAILABLE"})
        finally:
            body.clear()

        try:
            findings = set()
            for field in fields:
                categories = {result.entity_type for result in detect(field["text"])}
                for entity_type in forbidden_categories(
                    categories, set(field["allowedEntityTypes"])
                ):
                    findings.add((field["fieldId"], entity_type))
            return JSONResponse(
                content={
                    "verdict": "rejected" if findings else "accepted",
                    "modelPolicyVersion": MODEL_POLICY_VERSION,
                    "findings": [
                        {"fieldId": field_id, "entityType": entity_type}
                        for field_id, entity_type in sorted(findings)
                    ],
                }
            )
        except Exception:  # noqa: BLE001 - fail closed without exposing input or exception
            return JSONResponse(status_code=503, content={"code": "ANALYZER_UNAVAILABLE"})

    return app


def serve() -> None:
    import uvicorn

    get_analyzer()  # Fail startup before accepting requests if model/registry fails.
    uvicorn.run(
        create_app(),
        host=os.environ.get("ANALYZER_BIND_HOST", "127.0.0.1"),
        port=int(os.environ.get("ANALYZER_PORT", "8000")),
        access_log=False,
        server_header=False,
    )
