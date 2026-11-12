"""Contratto HTTP uniforme; injection esclusivamente prima dell'adapter nativo."""

import json
from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient
from free_text_personal_data_check.app import create_app


def native(category, text="Mario", **overrides):
    return SimpleNamespace(
        **{"entity_type": category, "start": 0, "end": len(text), "score": 0.8, **overrides}
    )


def field(text="Mario", **overrides):
    return {"fieldId": "description", "text": text, **overrides}


def client(results=(), *, detect_fn=None, ready_fn=lambda: True):
    return TestClient(
        create_app(detect_fn=detect_fn or (lambda _: list(results)), ready_fn=ready_fn)
    )


def test_known_extra_is_ignored_and_person_is_projected_before_policy():
    response = client([native("LOCATION"), native("PERSON")]).post(
        "/v1/analyze", json={"fields": [field()]}
    )
    assert response.status_code == 200
    assert response.json() == {
        "verdict": "rejected",
        "findings": [{"fieldId": "description", "category": "PERSON"}],
    }
    accepted = client([native("LOCATION"), native("PERSON")]).post(
        "/v1/analyze", json={"fields": [field(allowedCategories=["PERSON", "PERSON"])]}
    )
    assert accepted.json() == {"verdict": "accepted", "findings": []}


@pytest.mark.parametrize(
    "results",
    [
        None,
        {},
        "PERSON",
        [None],
        [native("NATIVE_UNRECOGNIZED")],
        [native("PERSON", score=float("nan"))],
        [native("PERSON", score=True)],
        [native("PERSON", score=1.1)],
        [native("PERSON", start=-1)],
        [native("PERSON", end=6)],
        [native("PERSON", end=0)],
        [native("PERSON", start=True)],
        [native("LOCATION", score="bad")],
    ],
)
def test_malformed_native_results_fail_closed(results):
    response = client(detect_fn=lambda _: results).post("/v1/analyze", json={"fields": [field()]})
    assert response.status_code == 503
    assert response.json() == {"code": "detector_unavailable"}


def test_known_extra_only_is_accepted():
    from free_text_personal_data_check.policy import KNOWN_EXTRAS

    response = client([native(cat) for cat in KNOWN_EXTRAS]).post(
        "/v1/analyze", json={"fields": [field()]}
    )
    assert response.json() == {"verdict": "accepted", "findings": []}


@pytest.mark.parametrize(
    "method,path",
    [
        ("GET", "/v1/analyze"),
        ("POST", "/health/ready"),
        ("HEAD", "/health/ready"),
        ("POST", "/v1/analyze/"),
        ("POST", "/v1/analyze?x=1"),
        ("POST", "/v1/%61nalyze"),
        ("GET", "/health/ready/"),
        ("OPTIONS", "/v1/analyze"),
    ],
)
def test_only_exact_raw_routes(method, path):
    response = client().request(method, path, follow_redirects=False)
    assert response.status_code == 404
    if method != "HEAD":
        assert response.json() == {"code": "not_found"}


@pytest.mark.parametrize(
    "body",
    [
        b'{"fields":[],"fiel\\u0064s":[]}'.replace(b"\\\\", b"\\"),
        b'{"fields":[{"fieldId":"a","text":"x","text":"y"}]}',
        b'{"fields":[{"fieldId":"a","text":"\\ud800"}]}',
        b'{"fields":[{"fieldId":"\\udfff","text":""}]}',
        b'{"fields":[{"fieldId":"a","text":"\xff"}]}',
        b'\xef\xbb\xbf{"fields":[]}',
        '{"fields":[{"fieldId":"a","text":""}]}'.encode("utf-16"),
    ],
)
def test_strict_json_utf8_and_surrogates(body):
    response = client().post(
        "/v1/analyze", content=body, headers={"content-type": "application/json"}
    )
    assert response.status_code == 400
    assert response.json() == {"code": "invalid_request"}


def test_content_type_size_precedence_and_exact_limit():
    large = b" " * (1024 * 1024 + 1)
    c = client()
    assert c.post("/v1/analyze", content=large).json() == {"code": "invalid_request"}
    response = c.post("/v1/analyze", content=large, headers={"content-type": "application/json"})
    assert response.status_code == 413
    assert response.json() == {"code": "body_too_large"}
    body = json.dumps({"fields": [field("")]}).encode()
    response = c.post(
        "/v1/analyze",
        content=body + b" " * (1024 * 1024 - len(body)),
        headers={"content-type": " Application/JSON ; charset=utf-8"},
    )
    assert response.status_code == 200


@pytest.mark.parametrize(
    "fields",
    [
        [],
        [field(fieldId="")],
        [field(fieldId="😀" * 65)],
        [field(fieldId="a" * 129)],
        [field(text=3)],
        [field(allowedCategories=None)],
        [field(allowedCategories=["LOCATION"])],
        [field(allowedCategories=[[]])],
        [field(extra="secret")],
        [field(), field()],
        [field("a " * 51)],
        [field(fieldId=str(i)) for i in range(11)],
        [field(), field(fieldId="second", text="a " * 51)],
    ],
)
def test_entire_input_validated_before_detector(fields):
    calls = []
    response = client(detect_fn=lambda text: calls.append(text)).post(
        "/v1/analyze", json={"fields": fields}
    )
    assert response.status_code == 400
    assert response.json() == {"code": "invalid_request"}
    assert calls == []


@pytest.mark.parametrize(
    "separator",
    [
        " ",
        "\t",
        "\n",
        "\u0085",
        "\u00a0",
        "\u1680",
        "\u2000",
        "\u2028",
        "\u2029",
        "\u202f",
        "\u205f",
        "\u3000",
    ],
)
def test_unicode_white_space_limit(separator):
    c = client()
    assert (
        c.post("/v1/analyze", json={"fields": [field(separator.join(["x"] * 50))]}).status_code
        == 200
    )
    assert (
        c.post("/v1/analyze", json={"fields": [field(separator.join(["x"] * 51))]}).status_code
        == 400
    )


@pytest.mark.parametrize("separator", ["\x1c", "\x1d", "\x1e", "\x1f", "\u200b", "\ufeff"])
def test_not_unicode_white_space(separator):
    assert (
        client()
        .post("/v1/analyze", json={"fields": [field(separator.join(["x"] * 51))]})
        .status_code
        == 200
    )


def test_utf16_ids_dedup_and_canonical_order():
    fields = [field(fieldId="\ue000"), field(fieldId="😀"), field(fieldId="😀" * 64)]
    response = client([native("PERSON"), native("PERSON"), native("EMAIL_ADDRESS")]).post(
        "/v1/analyze", json={"fields": fields}
    )
    assert response.status_code == 200
    assert response.json()["findings"] == [
        {"fieldId": fid, "category": cat}
        for fid in ["😀", "😀" * 64, "\ue000"]
        for cat in ["EMAIL_ADDRESS", "PERSON"]
    ]


@pytest.mark.parametrize(
    "text,span,accepted",
    [
        ("tel 3331234567", "3331234567", True),
        ("tel +39 333 123 4567", "333 123 4567", True),
        ("tel 0039 333 123 4567", "333 123 4567", True),
        ("tel +33 3331234567", "3331234567", False),
        ("tel 0044 3331234567", "3331234567", False),
        ("tel +1 3331234567", "3331234567", False),
        ("tel 33312345678", "3331234567", False),
        ("tel 02 12345678", "02 12345678", True),
        ("codice ABC3331234567Z", "3331234567", False),
    ],
)
def test_phones_use_whole_original_envelope(text, span, accepted):
    start = text.index(span)
    response = client([native("PHONE_NUMBER", text, start=start, end=start + len(span))]).post(
        "/v1/analyze", json={"fields": [field(text)]}
    )
    assert response.status_code == 200
    assert response.json()["findings"] == (
        [{"fieldId": "description", "category": "PHONE_NUMBER"}] if accepted else []
    )


def test_second_field_failure_is_atomic_and_safe():
    def broken(text):
        if text == "secret":
            raise RuntimeError("secret")
        return [native("PERSON", text)]

    response = client(detect_fn=broken).post(
        "/v1/analyze", json={"fields": [field(), field("secret", fieldId="second")]}
    )
    assert response.status_code == 503
    assert response.json() == {"code": "detector_unavailable"}


def test_readiness_failure_does_not_override_input_validation():
    def broken(*args):
        raise RuntimeError("secret")

    c = client(detect_fn=broken, ready_fn=broken)
    assert c.get("/health/ready").json() == {"code": "detector_unavailable"}
    assert c.post("/v1/analyze", json={"fields": []}).status_code == 400
    assert c.post("/v1/analyze", json={"fields": [field()]}).status_code == 503
    assert client().get("/health/ready").json() == {"status": "ready"}
    assert client(ready_fn=lambda: False).get("/health/ready").status_code == 503


def test_real_engine_smoke():
    with TestClient(create_app()) as c:
        assert c.get("/health/ready").status_code == 200
        response = c.post(
            "/v1/analyze",
            json={
                "fields": [
                    field("mario.rossi@example.com", fieldId="email"),
                    field("RSSMRA80A01H501U", fieldId="fiscal"),
                    field("", fieldId="empty"),
                ]
            },
        )
        assert response.status_code == 200
        findings = response.json()["findings"]
        assert {"fieldId": "email", "category": "EMAIL_ADDRESS"} in findings
        assert {"fieldId": "fiscal", "category": "IT_FISCAL_CODE"} in findings
        assert set(response.json()) == {"verdict", "findings"}


def test_server_loopback_no_access_log(monkeypatch):
    import uvicorn
    from free_text_personal_data_check.app import serve

    calls = []
    monkeypatch.delenv("ANALYZER_BIND_HOST", raising=False)
    monkeypatch.setattr(uvicorn, "run", lambda app, **kwargs: calls.append(kwargs))
    serve()
    assert calls[0]["host"] == "127.0.0.1"
    assert calls[0]["access_log"] is False


def test_email_validator_never_fetches_public_suffix_list():
    import tldextract

    assert tldextract.tldextract.TLD_EXTRACTOR.suffix_list_urls == ()
    assert tldextract.tldextract.TLD_EXTRACTOR._cache.enabled is False
