"""Pinned Italian Presidio pipeline; raw detections never leave the process."""
# ruff: noqa: I001 - environment must be set before importing Presidio

from functools import lru_cache
import os

# Presidio's EmailRecognizer uses tldextract; force bundled PSL and no runtime fetch.
# Must be set before importing Presidio (which imports tldextract's singleton).
os.environ["TLDEXTRACT_PUBLIC_SUFFIX_LIST_URLS"] = ""
import tldextract  # Configure the singleton before Presidio imports it.

tldextract.tldextract.TLD_EXTRACTOR = tldextract.TLDExtract(
    suffix_list_urls=(), cache_dir=None, fallback_to_snapshot=True
)

from presidio_analyzer import AnalyzerEngine, RecognizerRegistry
from presidio_analyzer.nlp_engine import NlpEngineProvider

MODEL_POLICY_VERSION = "it-spacy-sm-3.8.0-poc1"
REQUIRED_ENTITIES = frozenset({"PERSON", "EMAIL_ADDRESS", "IT_FISCAL_CODE"})
SCORE_THRESHOLD = 0.35


@lru_cache(maxsize=1)
def get_analyzer() -> AnalyzerEngine:
    nlp_engine = NlpEngineProvider(
        nlp_configuration={
            "nlp_engine_name": "spacy",
            "models": [{"lang_code": "it", "model_name": "it_core_news_sm"}],
            "ner_model_configuration": {
                "model_to_presidio_entity_mapping": {
                    "PER": "PERSON",
                    "ORG": "ORGANIZATION",
                    "LOC": "LOCATION",
                },
            },
        }
    ).create_engine()
    registry = RecognizerRegistry(supported_languages=["it"])
    registry.load_predefined_recognizers(languages=["it"], nlp_engine=nlp_engine)
    engine = AnalyzerEngine(
        registry=registry,
        nlp_engine=nlp_engine,
        supported_languages=["it"],
        default_score_threshold=SCORE_THRESHOLD,
        log_decision_process=False,
    )
    if not REQUIRED_ENTITIES <= set(engine.get_supported_entities(language="it")):
        raise RuntimeError("Required recognizers unavailable")
    return engine


def detect(text: str, *, threshold: float = SCORE_THRESHOLD) -> list:
    return get_analyzer().analyze(
        text=text,
        language="it",
        score_threshold=threshold,
        return_decision_process=False,
    )
