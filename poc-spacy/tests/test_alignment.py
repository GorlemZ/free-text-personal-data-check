"""Phase 2 contract specifications; deliberately not executed in this handoff."""

from types import SimpleNamespace

import pytest
from fastapi.testclient import TestClient

from free_text_personal_data_check import analyzer, app, benchmark
from free_text_personal_data_check.policy import CATEGORIES, forbidden_categories
from free_text_personal_data_check.structured import valid_fiscal_code, validated_categories


def candidate(entity_type, text, value, score=0.8):
    start = text.index(value)
    return SimpleNamespace(
        entity_type=entity_type, start=start, end=start + len(value), score=score
    )


def test_catalog_filters_unknown_before_allowlist():
    assert CATEGORIES == frozenset(
        {
            "PERSON",
            "EMAIL_ADDRESS",
            "PHONE_NUMBER",
            "IT_FISCAL_CODE",
            "IT_VAT_CODE",
            "IBAN_CODE",
            "CREDIT_CARD",
            "IT_IDENTITY_CARD",
            "IT_DRIVER_LICENSE",
        }
    )
    assert forbidden_categories({"PERSON", "LOCATION"}, {"PERSON"}) == set()
    assert forbidden_categories({"PERSON", "LOCATION"}, set()) == {"PERSON"}


def test_installed_italian_registry_advertises_both_document_recognizers():
    supported = set(analyzer.get_analyzer().get_supported_entities(language="it"))
    assert {"IT_IDENTITY_CARD", "IT_DRIVER_LICENSE"} <= supported


@pytest.mark.parametrize("missing", ["IT_IDENTITY_CARD", "IT_DRIVER_LICENSE"])
def test_missing_italian_document_recognizer_fails_readiness_and_analysis(monkeypatch, missing):
    class Registry:
        def __init__(self, supported_languages):
            assert supported_languages == ["it"]
            self.loaded = False

        def load_predefined_recognizers(self, *, languages, nlp_engine):
            assert languages == ["it"]
            self.loaded = True

    class Engine:
        def __init__(self, *, registry, **kwargs):
            assert registry.loaded

        def get_supported_entities(self, *, language):
            assert language == "it"
            return analyzer.REQUIRED_ENTITIES - {missing}

    monkeypatch.setattr(
        analyzer,
        "NlpEngineProvider",
        lambda **_: SimpleNamespace(
            create_engine=lambda: object(),
        ),
    )
    monkeypatch.setattr(analyzer, "RecognizerRegistry", Registry)
    monkeypatch.setattr(analyzer, "AnalyzerEngine", Engine)
    monkeypatch.setattr(app, "get_analyzer", analyzer.get_analyzer)
    analyzer.get_analyzer.cache_clear()
    try:
        with pytest.raises(RuntimeError, match="Required recognizers unavailable"):
            analyzer.get_analyzer()
        with pytest.raises(RuntimeError, match="Required recognizers unavailable"):
            app.serve()  # Startup must fail before uvicorn accepts requests.
        with TestClient(app.create_app()) as client:
            ready = client.get("/health/ready")
            response = client.post(
                "/v1/analyze",
                json={
                    "fields": [
                        {
                            "fieldId": "description",
                            "text": "SENTINELSECRET",
                            "allowedEntityTypes": [],
                        }
                    ]
                },
            )
        assert ready.status_code == response.status_code == 503
        assert ready.json() == response.json() == {"code": "ANALYZER_UNAVAILABLE"}
        assert "SENTINELSECRET" not in response.text
    finally:
        analyzer.get_analyzer.cache_clear()


@pytest.mark.parametrize(
    "value,expected",
    [
        ("RSSMRA80A01H501U", True),
        ("rssmra80a01h501u", True),
        ("RSSMRA80A01H501A", False),
        ("RSSMRA80A01H501!", False),
        ("RSSMRA80A01H501", False),
    ],
)
def test_fiscal_code_checksum_and_canonical_shape(value, expected):
    assert valid_fiscal_code(value) is expected


@pytest.mark.parametrize(
    "entity,value,invalid",
    [
        ("IT_FISCAL_CODE", "RSSMRA80A01H501U", "RSSMRA80A01H501A"),
        ("IT_VAT_CODE", "12345678903", "12345678904"),
        ("IBAN_CODE", "IT60X0542811101000000123456", "IT61X0542811101000000123456"),
        ("CREDIT_CARD", "4111 1111 1111 1111", "4111 1111 1111 1112"),
        ("PHONE_NUMBER", "+39 333 1234567", "+1 333 1234567"),
    ],
)
def test_structured_identifiers_validate_native_spans_and_independent_matches(
    entity, value, invalid
):
    assert entity in validated_categories(value, [])
    assert entity in validated_categories(value, [candidate(entity, value, value)])
    assert entity not in validated_categories(invalid, [candidate(entity, invalid, invalid)])


def test_contextual_cf_none_still_detected_independently():
    text = "Codice fiscale: RSSMRA80A01H501U"
    assert "IT_FISCAL_CODE" in validated_categories(text, [])
    assert "IT_FISCAL_CODE" not in validated_categories("RSSMRA80A01H501A", [])


def test_embedded_tokens_and_combining_marks_do_not_yield_structured_matches():
    for text in ("xRSSMRA80A01H501U", "RSSMRA80A01H501Ux", "\u0301RSSMRA80A01H501U"):
        assert "IT_FISCAL_CODE" not in validated_categories(text, [])


def test_invalid_native_span_cannot_be_rescued_by_other_candidate():
    text = "RSSMRA80A01H501A"
    assert "IT_FISCAL_CODE" not in validated_categories(
        text,
        [
            candidate("IT_FISCAL_CODE", text, text),
            candidate("LOCATION", text, text),
        ],
    )
    assert validated_categories(text, [candidate("LOCATION", text, text)]) == set()


def test_out_of_range_native_span_is_ignored_and_overlap_preserves_valid_categories():
    text = "Mario RSSMRA80A01H501U"
    bad = SimpleNamespace(entity_type="IT_FISCAL_CODE", start=-1, end=len(text))
    person = candidate("PERSON", text, "Mario")
    assert validated_categories("Mario", [bad]) == set()
    assert validated_categories(text, [person, candidate("LOCATION", text, "Mario")]) == {
        "PERSON",
        "IT_FISCAL_CODE",
    }


def test_new_category_allowlist_only_removes_that_category():
    assert forbidden_categories({"IT_VAT_CODE", "PERSON"}, {"IT_VAT_CODE"}) == {"PERSON"}


def test_api_rejects_out_of_catalog_allowlist_and_ignores_unknown_detection(monkeypatch):
    from fastapi.testclient import TestClient

    monkeypatch.setattr(
        app,
        "get_analyzer",
        lambda: SimpleNamespace(get_supported_entities=lambda **_: ["LOCATION"]),
    )
    monkeypatch.setattr(app, "detect", lambda text: [candidate("LOCATION", text, text)])
    with TestClient(app.create_app()) as client:
        payload = {
            "fields": [
                {"fieldId": "description", "text": "Roma", "allowedEntityTypes": ["LOCATION"]}
            ]
        }
        assert client.post("/v1/analyze", json=payload).status_code == 400
        payload["fields"][0]["allowedEntityTypes"] = []
        result = client.post("/v1/analyze", json=payload)
        assert result.status_code == 200
        assert result.json()["verdict"] == "accepted"
        assert result.json()["findings"] == []


def test_api_invalid_native_finding_does_not_reject(monkeypatch):
    from fastapi.testclient import TestClient

    text = "RSSMRA80A01H501A"
    monkeypatch.setattr(app, "get_analyzer", lambda: object())
    monkeypatch.setattr(app, "detect", lambda _: [candidate("IT_FISCAL_CODE", text, text)])
    with TestClient(app.create_app()) as client:
        result = client.post(
            "/v1/analyze",
            json={
                "fields": [
                    {
                        "fieldId": "description",
                        "text": text,
                        "allowedEntityTypes": [],
                    }
                ]
            },
        )
    assert result.status_code == 200
    assert result.json()["findings"] == []
    assert text not in result.text


def test_api_filters_catalog_before_allowlist_with_overlapping_labels(monkeypatch):
    from fastapi.testclient import TestClient

    text = "RSSMRA80A01H501U"
    monkeypatch.setattr(app, "get_analyzer", lambda: object())
    monkeypatch.setattr(
        app,
        "detect",
        lambda _: [
            candidate("LOCATION", text, text),
            candidate("IT_FISCAL_CODE", text, text),
        ],
    )
    with TestClient(app.create_app()) as client:
        payload = {"fields": [{"fieldId": "description", "text": text, "allowedEntityTypes": []}]}
        denied = client.post("/v1/analyze", json=payload)
        payload["fields"][0]["allowedEntityTypes"] = ["IT_FISCAL_CODE"]
        accepted = client.post("/v1/analyze", json=payload)
    assert denied.json()["findings"] == [{"fieldId": "description", "entityType": "IT_FISCAL_CODE"}]
    assert accepted.json()["verdict"] == "accepted"
    assert accepted.json()["findings"] == []


def test_benchmark_uses_same_validated_detection_path():
    assert benchmark.validated_categories is validated_categories
