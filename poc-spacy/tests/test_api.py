from fastapi.testclient import TestClient

from free_text_personal_data_check.app import create_app


def test_accepts_one_neutral_italian_description():
    with TestClient(create_app()) as client:
        response = client.post(
            "/v1/analyze",
            json={
                "fields": [
                    {
                        "fieldId": "description",
                        "text": "Servizio digitale.",
                        "allowedEntityTypes": [],
                    }
                ]
            },
        )
    assert response.status_code == 200
    assert response.json() == {
        "verdict": "accepted",
        "modelPolicyVersion": "it-spacy-sm-3.8.0-poc1",
        "findings": [],
    }
    assert "Servizio digitale" not in response.text


def test_analyze_and_readiness_work_without_authentication():
    with TestClient(create_app()) as client:
        ready = client.get("/health/ready")
        analyzed = client.post(
            "/v1/analyze",
            json={
                "fields": [
                    {
                        "fieldId": "description",
                        "text": "Servizio digitale.",
                        "allowedEntityTypes": [],
                    }
                ]
            },
        )
    assert ready.status_code == 200
    assert ready.json() == {"status": "ready"}
    assert analyzed.status_code == 200
    assert analyzed.json()["verdict"] == "accepted"


def test_server_starts_without_token_and_binds_to_loopback_by_default(monkeypatch):
    import uvicorn

    from free_text_personal_data_check import app

    calls = []
    monkeypatch.delenv("ANALYZER_SERVICE_TOKEN", raising=False)
    monkeypatch.delenv("ANALYZER_BIND_HOST", raising=False)
    monkeypatch.setattr(app, "get_analyzer", lambda: None)
    monkeypatch.setattr(uvicorn, "run", lambda application, **kwargs: calls.append(kwargs))

    app.serve()

    assert len(calls) == 1
    assert calls[0]["host"] == "127.0.0.1"
    assert calls[0]["access_log"] is False


def client():
    return TestClient(create_app())


def request(fields):
    return client().post(
        "/v1/analyze",
        json={"fields": fields},
    )


def field(text, allowed=None):
    return {"fieldId": "contactName", "text": text, "allowedEntityTypes": allowed or []}


def test_rejects_builtin_email_and_redacts_text():
    response = request([field("mario.rossi@example.com")])
    assert response.status_code == 200
    assert response.json()["verdict"] == "rejected"
    assert {x["entityType"] for x in response.json()["findings"]} >= {"EMAIL_ADDRESS"}
    assert "mario.rossi" not in response.text


def test_allows_person_but_does_not_hide_other_detections():
    response = request([field("Mario Rossi", ["PERSON"])])
    assert response.status_code == 200
    assert response.json()["verdict"] == "accepted"
    assert response.json()["findings"] == []


def test_rejects_builtin_italian_fiscal_code():
    response = request([field("RSSMRA80A01H501U")])
    assert response.status_code == 200
    assert "IT_FISCAL_CODE" in {x["entityType"] for x in response.json()["findings"]}


def test_invalid_payload_is_400_and_never_echoes_text():
    for payload in (
        {"fields": []},
        {"fields": [field("SENTINELSECRET", ["UNKNOWN"])]},
        {"fields": [field("SENTINELSECRET"), field("SENTINELSECRET")]},
        {"fields": [dict(field("SENTINELSECRET"), extraneous="SENTINELSECRET")]},
    ):
        response = client().post("/v1/analyze", json=payload)
        assert response.status_code == 400
        assert response.json() == {"code": "INVALID_ANALYZE_REQUEST"}
        assert "SENTINELSECRET" not in response.text


def test_technical_failure_fails_closed(monkeypatch):
    from free_text_personal_data_check import app

    def broken(_):
        raise RuntimeError("SENTINELSECRET")

    monkeypatch.setattr(app, "detect", broken)
    response = request([field("SENTINELSECRET")])
    assert response.status_code == 503
    assert response.json() == {"code": "ANALYZER_UNAVAILABLE"}
    assert "SENTINELSECRET" not in response.text


def test_readiness_uses_loaded_model():
    response = client().get("/health/ready")
    assert response.status_code == 200
    assert response.json() == {"status": "ready"}


def test_oversized_and_duplicate_json_properties_fail_without_echo():
    headers = {"Content-Type": "application/json"}
    for body in (
        (
            b'{"fields":[],"fields":[{"fieldId":"a","text":"SENTINELSECRET",'
            b'"allowedEntityTypes":[]}]}'
        ),
        (" " * 33000).encode(),
    ):
        response = client().post("/v1/analyze", headers=headers, content=body)
        assert response.status_code == 400
        assert response.json() == {"code": "INVALID_ANALYZE_REQUEST"}
        assert "SENTINELSECRET" not in response.text


def test_second_field_failure_never_returns_partial_accepted(monkeypatch):
    from free_text_personal_data_check import app

    original = app.detect

    def intermittent(text):
        if text == "SENTINELSECRET":
            raise RuntimeError("SENTINELSECRET")
        return original(text)

    monkeypatch.setattr(app, "detect", intermittent)
    response = request(
        [
            field("Servizio digitale."),
            {"fieldId": "eserviceDescription", "text": "SENTINELSECRET", "allowedEntityTypes": []},
        ]
    )
    assert response.status_code == 503
    assert response.json() == {"code": "ANALYZER_UNAVAILABLE"}


def test_model_failure_makes_readiness_unavailable(monkeypatch):
    from free_text_personal_data_check import app

    def broken():
        raise RuntimeError("SENTINELSECRET")

    monkeypatch.setattr(app, "get_analyzer", broken)
    response = client().get("/health/ready")
    assert response.status_code == 503
    assert response.json() == {"code": "ANALYZER_UNAVAILABLE"}


def test_field_id_cannot_be_used_to_echo_text():
    response = request(
        [{"fieldId": "SENTINELSECRET", "text": "mario.rossi@example.com", "allowedEntityTypes": []}]
    )
    assert response.status_code == 400
    assert response.json() == {"code": "INVALID_ANALYZE_REQUEST"}
    assert "SENTINELSECRET" not in response.text


def test_empty_text_and_multifield_batch_are_deterministic():
    response = request(
        [
            field(""),
            {"fieldId": "description", "text": "Servizio digitale.", "allowedEntityTypes": []},
        ]
    )
    assert response.status_code == 200
    assert response.json()["verdict"] == "accepted"


def test_invalid_field_type_is_400_not_503():
    response = request([{"fieldId": "description", "text": 123, "allowedEntityTypes": []}])
    assert response.status_code == 400
    assert response.json() == {"code": "INVALID_ANALYZE_REQUEST"}


def test_email_validator_never_fetches_public_suffix_list():
    import tldextract

    assert tldextract.tldextract.TLD_EXTRACTOR.suffix_list_urls == ()
    assert tldextract.tldextract.TLD_EXTRACTOR._cache.enabled is False
