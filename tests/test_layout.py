"""Repository workspace layout contract."""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]

class LayoutTests(unittest.TestCase):
    def test_detector_workspace_layout(self):
        for name in ("packages/detector-http", "poc-bardsai", "poc-horizon", "poc-rizzo", "poc-presidio", "tests"):
            self.assertTrue((ROOT / name).is_dir(), name)
        self.assertTrue((ROOT / "pnpm-workspace.yaml").is_file())
        package = json.loads((ROOT / "poc-bardsai/package.json").read_text())
        self.assertEqual(package["name"], "poc-bardsai-pii-check")
        self.assertTrue((ROOT / "tests/evaluation/results/category-detection-v3-2026-11-17/report.md").is_file())

if __name__ == "__main__":
    unittest.main()
