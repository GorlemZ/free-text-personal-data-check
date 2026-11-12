"""Repository layout contract; run from the repository root."""
from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class LayoutTests(unittest.TestCase):
    def test_four_operational_directories(self):
        actual = {p.name for p in ROOT.iterdir() if p.is_dir() and not p.name.startswith('.')}
        self.assertEqual(actual, {'tests', 'poc-horizon', 'poc-rizzo', 'poc-presidio'})

    def test_test_suites_are_centralized(self):
        for name in ('horizon', 'rizzo', 'presidio'):
            self.assertTrue((ROOT / 'tests' / name).is_dir(), name)
            self.assertFalse((ROOT / ('poc-' + name) / 'tests').exists(), name)
        self.assertTrue((ROOT / 'tests' / 'evaluation' / 'runner.py').is_file())
        self.assertFalse((ROOT / 'tests' / 'evaluation' / 'prepare_gold.py').exists())

    def test_legacy_benchmarks_are_removed(self):
        self.assertFalse((ROOT / 'tests' / 'bench').exists())

if __name__ == '__main__':
    unittest.main()
