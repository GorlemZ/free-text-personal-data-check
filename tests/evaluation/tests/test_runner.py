import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner


class MetricsTests(unittest.TestCase):
    def test_asymmetric_confusion_and_undefined_denominators(self):
        result = runner.binary_metrics([True, True, True, False, False], [True, False, False, True, False])
        self.assertEqual({k: result[k] for k in ('tp', 'fp', 'fn', 'tn')}, dict(tp=1, fp=1, fn=2, tn=1))
        self.assertEqual(result['recall'], 1 / 3)
        self.assertEqual(result['precision'], 1 / 2)
        self.assertEqual(result['accuracy'], 2 / 5)
        self.assertEqual(result['balancedAccuracy'], (1 / 3 + 1 / 2) / 2)
        self.assertEqual(result['falseAcceptanceRate'], 2 / 3)
        self.assertEqual(result['falseRejectionRate'], 1 / 2)
        self.assertIsNone(runner.binary_metrics([], [])['precision'])
        self.assertIsNone(runner.binary_metrics([False], [False])['recall'])
        self.assertIsNone(runner.binary_metrics([True], [True])['specificity'])
        with self.assertRaises(ValueError):
            runner.binary_metrics([True], [])


if __name__ == '__main__':
    unittest.main()
