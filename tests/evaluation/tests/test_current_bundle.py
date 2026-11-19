import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
import runner

RESULTS=ROOT/'results'/'bardsai-v2-category-detection-2026-11-18'


class CurrentBundleTests(unittest.TestCase):
    def test_current_bundle_is_complete_sanitized_and_renders_byte_identically(self):
        result=json.loads((RESULTS/'results.json').read_text())
        runner.validate_result(result)
        self.assertEqual(result['caseCount'],142)
        self.assertEqual(len(result['observations']),142)
        self.assertEqual(set(path.name for path in RESULTS.iterdir()),
                         {'results.json','summary.csv','verdict.csv','category.csv','differences.csv','report.md','provenance.json'})
        provenance=json.loads((RESULTS/'provenance.json').read_text())
        self.assertEqual(provenance['modelRevision'],'07a9a69b0d75c551f5f9450b290f864bfc7dfb51')
        self.assertEqual(provenance['goldSha256'],'fcd165520fdd53ba6e9335d7a174a4ab7cb9dfe4e754bd6c60b4cbb8e653cb73')
        gold=json.loads((ROOT/'gold.json').read_text())
        exported=json.dumps(result,ensure_ascii=False)
        self.assertTrue(all(case['text'] not in exported for case in gold['cases']))
        expected_projection=[(case['id'],case['expected'],'rejected' if case['expected'] else 'accepted')
                             for case in gold['cases'] for _ in result['engines']]
        observed_projection=[(item['caseId'],item['expectedCategories'],item['expectedVerdict'])
                             for item in result['observations']]
        self.assertEqual(observed_projection,expected_projection)
        expected={
            'bardsai': {'verdict':(96,7,3,36),'bodyExact':125},
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
            for filename in runner.OUTPUT_NAMES:
                self.assertEqual((RESULTS/filename).read_bytes(),(rendered/filename).read_bytes(),filename)


if __name__=='__main__': unittest.main()
