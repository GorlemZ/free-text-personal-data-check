import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner


class MetricsTests(unittest.TestCase):
    def test_asymmetric_confusion_and_undefined_denominators(self):
        result = runner.binary_metrics([True, True, True, False, False], [True, False, False, True, False])
        self.assertEqual({k: result[k] for k in ('tp','fp','fn','tn')}, dict(tp=1,fp=1,fn=2,tn=1))
        self.assertEqual(result['recall'], 1/3)
        self.assertEqual(result['precision'], 1/2)
        self.assertEqual(result['accuracy'], 2/5)
        self.assertIsNone(runner.binary_metrics([], [])['precision'])
        with self.assertRaises(ValueError): runner.binary_metrics([True], [])

    def test_score_separates_verdict_body_and_category_correctness(self):
        observations=[]
        for case_id, expected_verdict, expected_categories, observed_categories, body_exact in [
                ('positive','rejected',['PERSON'],['EMAIL_ADDRESS'],False),
                ('negative','accepted',[],[],True)]:
            for engine in runner.ENGINES:
                observations.append(dict(caseId=case_id,engine=engine,expectedVerdict=expected_verdict,
                    observedVerdict=expected_verdict,expectedCategories=expected_categories,
                    observedCategories=observed_categories,verdictCorrect=True,bodyExact=body_exact))
        result={'schemaVersion':3,'goldVersion':'category-detection-1','catalog':runner.CATALOG,
                'engines':runner.ENGINES,'caseCount':2,'observations':observations}
        metrics=runner.score(result)
        self.assertEqual(metrics['summary']['bardsai'], {'cases':2,'verdictCorrect':2,'verdictIncorrect':0,'bodyMatch':1,'bodyMismatch':1})
        self.assertEqual({k:metrics['categories']['bardsai']['PERSON'][k] for k in ('tp','fp','fn','tn')},
                         {'tp':0,'fp':0,'fn':1,'tn':1})
        self.assertEqual({k:metrics['verdict']['bardsai'][k] for k in ('tp','fp','fn','tn')},
                         {'tp':1,'fp':0,'fn':0,'tn':1})


if __name__ == '__main__': unittest.main()
