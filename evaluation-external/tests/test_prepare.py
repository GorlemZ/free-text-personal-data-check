import importlib.util
import json
from pathlib import Path
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))


class PreparationTests(unittest.TestCase):
    def test_offline_preparation_is_deterministic_and_bounded(self):
        self.assertTrue((ROOT / 'prepare_gold.py').exists(), 'Missing reproducible preparation')
        spec = importlib.util.spec_from_file_location('prepare_gold', ROOT / 'prepare_gold.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        first = module.build_gold()
        self.assertEqual(first, module.build_gold())
        cases = first['cases']
        texts = [f['text'] for c in cases for f in c['fields']]
        self.assertLessEqual(len(texts), 100)
        self.assertTrue(all(len(t.split()) <= 50 for t in texts))
        self.assertEqual(sum(c['source'] != 'targeted' for c in cases), 28)
        self.assertEqual(len(set(texts)), 54)
        self.assertEqual({c for case in cases for f in case['fields'] for c in f['expected']}, set(module.CATALOG))
        self.assertTrue(all(c['review']['completeTextRead'] for c in cases))
        self.assertTrue(any(f['unknown'] for c in cases for f in c['fields']))
        self.assertTrue(any(len(c['fields']) > 1 for c in cases))
        self.assertEqual(first, json.loads((ROOT / 'gold.json').read_text()))


if __name__ == '__main__':
    unittest.main()
