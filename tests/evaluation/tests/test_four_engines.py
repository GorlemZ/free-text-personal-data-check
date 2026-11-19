import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner
from test_contract import gold_fixture

class FourEngineTests(unittest.TestCase):
    def test_collect_four_and_validate_historical_bundles(self):
        engines = ["rizzo", "horizon", "presidio", "bardsai"]
        cases = gold_fixture()["cases"]
        with patch.object(runner, "request_once", side_effect=lambda url, case, timeout: runner.expected_response(case)):
            result = runner.collect(cases, {e: "http://localhost" for e in engines})
        self.assertEqual(result["engines"], engines)
        self.assertEqual(len(result["observations"]), len(cases) * 4)
        for folder in ("category-detection-v3-2026-11-17", "bardsai-v2-category-detection-2026-11-18"):
            saved = json.loads((Path(__file__).resolve().parents[1] / "results" / folder / "results.json").read_text())
            runner.validate_result(saved)
            self.assertEqual(set(runner.score(saved)["summary"]), set(saved["engines"]))
