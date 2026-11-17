import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import runner

RESULTS=ROOT/'results'/'category-detection-v3-2026-11-17'


class CurrentBundleTests(unittest.TestCase):
    def test_current_bundle_is_complete_sanitized_and_renders_byte_identically(self):
        result=json.loads((RESULTS/'results.json').read_text())
        runner.validate_result(result)
        self.assertEqual(result['caseCount'],142)
        self.assertEqual(len(result['observations']),426)
        self.assertEqual(set(path.name for path in RESULTS.iterdir()),
                         {'results.json','summary.csv','verdict.csv','category.csv','differences.csv','report.md'})
        gold=json.loads((ROOT/'gold.json').read_text())
        exported=json.dumps(result,ensure_ascii=False)
        self.assertTrue(all(case['text'] not in exported for case in gold['cases']))
        expected_projection=[(case['id'],case['expected'],'rejected' if case['expected'] else 'accepted')
                             for case in gold['cases'] for _ in runner.ENGINES]
        observed_projection=[(item['caseId'],item['expectedCategories'],item['expectedVerdict'])
                             for item in result['observations']]
        self.assertEqual(observed_projection,expected_projection)
        expected={
            'rizzo': {'verdict':(97,9,2,34),'bodyExact':113},
            'horizon': {'verdict':(98,6,1,37),'bodyExact':122},
            'presidio': {'verdict':(79,8,20,35),'bodyExact':101},
        }
        metrics=runner.score(result)
        for engine, values in expected.items():
            verdict=metrics['verdict'][engine]
            self.assertEqual(tuple(verdict[k] for k in ('tp','fp','fn','tn')),values['verdict'])
            self.assertEqual(metrics['summary'][engine]['bodyMatch'],values['bodyExact'])
            self.assertEqual(metrics['summary'][engine]['bodyMatch']+metrics['summary'][engine]['bodyMismatch'],142)
            self.assertEqual(metrics['summary'][engine]['verdictCorrect']+metrics['summary'][engine]['verdictIncorrect'],142)
            for category in runner.CATALOG:
                matrix=metrics['categories'][engine][category]
                self.assertEqual(sum(matrix[k] for k in ('tp','fp','fn','tn')),142)
        with tempfile.TemporaryDirectory() as temp:
            rendered=Path(temp)/'rendered'
            runner.write_reports(result,rendered)
            for path in RESULTS.iterdir():
                self.assertEqual(path.read_bytes(),(rendered/path.name).read_bytes(),path.name)


if __name__=='__main__': unittest.main()
