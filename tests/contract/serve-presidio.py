"""Server fixture su loopback: sostituisce soltanto l'output nativo Presidio."""

import os
from types import SimpleNamespace

import uvicorn
from free_text_personal_data_check.app import create_app
from free_text_personal_data_check.http_protocol import ExactTargetProtocol


def ready():
    if os.environ.get("CONTRACT_UNAVAILABLE") == "1":
        raise RuntimeError("fixture unavailable")
    return True


def detect(text):
    ready()
    if text == "fixture:throw":
        raise RuntimeError("fixture failure")
    if text == "fixture:malformed":
        return [SimpleNamespace(entity_type="PERSON", start=0, end=1, score="bad")]
    labels = {
        "fixture:extra": ["LOCATION"],
        "fixture:person": ["PERSON"],
        "fixture:extra-person": ["LOCATION", "PERSON"],
        "fixture:person-aliases": ["PERSON", "PERSON"],
        "fixture:unknown": ["NATIVE_UNRECOGNIZED"],
        "fixture:phone 3331234567": ["PHONE_NUMBER"],
    }.get(text, [])
    start = text.index("3331234567") if labels == ["PHONE_NUMBER"] else 0
    return [
        SimpleNamespace(entity_type=label, start=start, end=len(text), score=0.9)
        for label in labels
    ]


if __name__ == "__main__":
    uvicorn.run(
        create_app(detect_fn=detect, ready_fn=ready),
        host="127.0.0.1",
        port=int(os.environ["PORT"]),
        access_log=False,
        server_header=False,
        http=ExactTargetProtocol,
        log_level="warning",
    )
