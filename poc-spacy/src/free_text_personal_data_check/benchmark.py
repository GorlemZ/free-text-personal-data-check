"""Offline aggregate-only benchmark. Never print individual examples or detections."""

import json
import math
from collections import Counter
from pathlib import Path
from statistics import median
from time import perf_counter

from .analyzer import MODEL_POLICY_VERSION, SCORE_THRESHOLD, detect
from .policy import forbidden_categories

CATEGORIES = frozenset(
    {
        "PERSON",
        "EMAIL_ADDRESS",
        "IT_FISCAL_CODE",
        "PHONE_NUMBER",
        "IBAN_CODE",
        "DATE_TIME",
        "ORGANIZATION",
        "LOCATION",
    }
)
CORPUS = Path(__file__).resolve().parents[2] / "bench" / "corpus.json"


def _confusion() -> dict:
    return {"tp": 0, "fp": 0, "fn": 0, "tn": 0, "denominator": 0}


def _tally(counts: dict, actual: set[str], predicted: set[str], universe: set[str]) -> None:
    for category in universe:
        if category in actual and category in predicted:
            counts["tp"] += 1
        elif category in predicted:
            counts["fp"] += 1
        elif category in actual:
            counts["fn"] += 1
        else:
            counts["tn"] += 1
        counts["denominator"] += 1


def _rates(counts: dict) -> dict:
    tp, fp, fn = counts["tp"], counts["fp"], counts["fn"]
    return {
        **counts,
        "precision": tp / (tp + fp) if tp + fp else None,
        "recall": tp / (tp + fn) if tp + fn else None,
    }


def _percentile(values: list[float], percentile: float) -> float | None:
    if not values:
        return None
    values = sorted(values)
    position = math.ceil(percentile * len(values)) - 1
    return round(values[max(position, 0)], 3)


def evaluate(*, corpus: Path = CORPUS, threshold: float = SCORE_THRESHOLD) -> dict:
    """Per field/category units. Missing detector runs contribute only to technicalErrors."""
    if not 0 <= threshold <= 1:
        raise ValueError("Invalid threshold")
    samples = json.loads(corpus.read_text(encoding="utf-8"))
    detector, policy = _confusion(), _confusion()
    by_category = {category: _confusion() for category in sorted(CATEGORIES)}
    by_split = {
        name: {"detector": _confusion(), "policy": _confusion()}
        for name in ("calibration", "evaluation")
    }
    failures = Counter()
    latencies = []
    splits = Counter()
    technical_errors = 0
    for sample in samples:
        splits[sample["split"]] += 1
        split = by_split[sample["split"]]
        start = perf_counter()
        try:
            # Observe pre-policy candidates at zero threshold; same configured engine and mapping.
            candidates = detect(sample["text"], threshold=0)
        except Exception:  # noqa: BLE001 - count technical failures without exporting input
            technical_errors += 1
            continue
        latencies.append((perf_counter() - start) * 1000)
        predicted = {r.entity_type for r in candidates if r.score >= threshold}
        candidate_types = {r.entity_type for r in candidates}
        expected = set(sample["expectedEntities"])
        allowed = set(sample["allowedEntityTypes"])
        for missing in expected - predicted:
            failures["belowThreshold" if missing in candidate_types else "noCandidate"] += 1
        for category in CATEGORIES:
            _tally(by_category[category], expected, predicted, {category})
        _tally(detector, expected, predicted, set(CATEGORIES))
        _tally(split["detector"], expected, predicted, set(CATEGORIES))
        actual_denied = forbidden_categories(expected, allowed)
        predicted_denied = forbidden_categories(predicted, allowed)
        # Policy is an operation-level reject/accept binary decision.
        _tally(
            policy,
            {"reject"} if actual_denied else set(),
            {"reject"} if predicted_denied else set(),
            {"reject"},
        )
        _tally(
            split["policy"],
            {"reject"} if actual_denied else set(),
            {"reject"} if predicted_denied else set(),
            {"reject"},
        )
    return {
        "modelPolicyVersion": MODEL_POLICY_VERSION,
        "threshold": threshold,
        "samples": len(samples),
        "splits": dict(splits),
        "technicalErrors": technical_errors,
        "detector": _rates(detector),
        "byCategory": {k: _rates(v) for k, v in by_category.items()},
        "bySplit": {
            name: {kind: _rates(counts) for kind, counts in metrics.items()}
            for name, metrics in by_split.items()
        },
        "policy": _rates(policy),
        "falseNegativeDiagnosis": dict(failures),
        "latencyMs": {
            "p50": round(median(latencies), 3) if latencies else None,
            "p95": _percentile(latencies, 0.95),
            "p99": _percentile(latencies, 0.99),
            "completed": len(latencies),
        },
    }


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Aggregate-only synthetic benchmark")
    parser.add_argument("--threshold", type=float, default=SCORE_THRESHOLD)
    args = parser.parse_args()
    print(json.dumps(evaluate(threshold=args.threshold), sort_keys=True))


if __name__ == "__main__":
    main()
