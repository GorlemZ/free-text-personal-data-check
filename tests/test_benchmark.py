"""Offline harness contract: aggregate-only metrics and independent detector/policy truth."""

import json

from free_text_personal_data_check.benchmark import evaluate


def test_benchmark_has_ten_scenarios_and_no_individual_outputs(capsys):
    report = evaluate()
    serialized = json.dumps(report, ensure_ascii=False)
    assert report["samples"] == 10
    assert report["splits"] == {"calibration": 5, "evaluation": 5}
    assert report["detector"]["denominator"] > 0
    assert report["policy"]["denominator"] == 10
    assert report["bySplit"]["calibration"]["policy"]["denominator"] == 5
    assert report["bySplit"]["evaluation"]["detector"]["denominator"] == 40
    assert "mario.rossi@example.com" not in serialized
    assert "RSSMRA80A01H501U" not in serialized
    assert "text" not in report
    assert capsys.readouterr().out == ""


def test_benchmark_failure_is_not_counted_as_true_negative(monkeypatch):
    from free_text_personal_data_check import benchmark

    def broken(*args, **kwargs):
        raise RuntimeError("SENTINELSECRET")

    monkeypatch.setattr(benchmark, "detect", broken)
    report = evaluate()
    assert report["technicalErrors"] == 10
    assert report["detector"]["denominator"] == 0
    assert report["policy"]["denominator"] == 0
    assert "SENTINELSECRET" not in json.dumps(report)
