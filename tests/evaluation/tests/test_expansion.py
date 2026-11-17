"""Regression checks for the literal external-corpus expansion, without inference."""
import hashlib
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner


class ExpansionTests(unittest.TestCase):
    def setUp(self):
        self.gold = json.loads((ROOT / 'gold.json').read_text())
        self.original = self.gold['cases'][:91]
        self.added = self.gold['cases'][91:]

    def test_previous_91_complete_case_objects_are_unchanged(self):
        digest = hashlib.sha256(json.dumps(self.original, sort_keys=True, ensure_ascii=False).encode()).hexdigest()
        self.assertEqual(digest, 'b8c29bdcd3a2c04c07d90acb7399df428d8558c581c9688f21da981779b69426')

    def test_at_least_50_new_complete_distinct_reviewed_literals(self):
        self.assertGreaterEqual(len(self.added), 50)
        old_texts = {' '.join(f['text'].split()) for c in self.original for f in c['fields']}
        new_texts = [' '.join(c['fields'][0]['text'].split()) for c in self.added]
        self.assertEqual(len(new_texts), len(set(new_texts)))
        self.assertTrue(old_texts.isdisjoint(new_texts))
        self.assertEqual({c['source'] for c in self.added}, {'gretel', 'aliasit'})
        for case in self.added:
            with self.subTest(case=case['id']):
                self.assertEqual(len(case['fields']), 1)
                field = case['fields'][0]
                self.assertLessEqual(runner.words(field['text']), 50)
                self.assertTrue(field['text'])
                self.assertTrue(case['review']['completeTextRead'])
                self.assertTrue(case['review']['independentReview'])
                self.assertTrue(case['review']['note'])
                provenance = case['provenance']
                self.assertEqual(provenance['cohort'], 'external-expansion-1')
                self.assertTrue(provenance['selectionRationale'])
                self.assertTrue(provenance['license'])
                self.assertTrue(provenance['repo'])
                self.assertTrue(provenance['path'])
                self.assertEqual(provenance['revision'], self.gold['sourceFiles'][case['source']]['revision'])
                self.assertIs(type(provenance['row']), int)
                self.assertGreaterEqual(provenance['row'], 0)
                self.assertEqual(provenance['textSha256'], hashlib.sha256(field['text'].encode()).hexdigest())
                if case['source'] == 'aliasit':
                    self.assertTrue(provenance['upstreamRepo'])
                    self.assertTrue(provenance['upstreamRevision'])
                    self.assertNotIn(provenance['upstreamSource'], ('rizzo', 'deepmount_pii', 'deepmount_gliner'))
                for span in provenance['upstreamSpans']:
                    self.assertTrue(0 <= span['start'] < span['end'] <= len(field['text']))

    def test_uncertainty_remains_explicit_before_inference(self):
        # Review resolved the proposed uncertain additions: do not manufacture unknowns.
        self.assertEqual(sum(len(f['unknown']) for c in self.added for f in c['fields']), 0)
        self.assertEqual(sum(len(f['unknown']) for c in self.original for f in c['fields']), 13)
        by_id = {c['id']: c for c in self.added}
        self.assertEqual(by_id['gretel-151']['fields'][0]['expected'], ['IT_VAT_CODE'])
        for case_id in ('gretel-180', 'aliasit-83', 'aliasit-90', 'aliasit-142', 'aliasit-3268'):
            self.assertEqual(by_id[case_id]['fields'][0]['unknown'], [])
        for case in self.gold['cases']:
            for field in case['fields']:
                self.assertFalse(set(field['expected']) & set(field['unknown']))
        self.assertEqual(self.gold['goldVersion'], 'uniform-pilot-3')
        self.assertTrue(self.gold['annotationsBeforeNewRun'])
        self.assertFalse(self.gold['heldout'])

    def test_corrected_selection_rationales_match_current_policy(self):
        ids = {'gretel-151', 'gretel-180', 'aliasit-83', 'aliasit-90', 'aliasit-142', 'aliasit-3268'}
        corrected = [c for c in self.added if c['id'] in ids]
        self.assertEqual(len(corrected), 6)
        for case in corrected:
            self.assertTrue(case['provenance']['selectionRationale'].endswith(
                'Current policy: ' + runner.expected_verdict(case) + '.'))
            self.assertEqual(case['fields'][0]['unknown'], [])

    def test_current_exports_render_byte_identically_and_match_receipt(self):
        current = ROOT / 'results' / 'main-2026-11-17'
        result = json.loads((current / 'results.json').read_text())
        context = json.loads((current / 'run-context.json').read_text())
        with tempfile.TemporaryDirectory() as temp:
            output = Path(temp)
            runner.write_reports(result, output)
            for name in ('results.json', 'observations.csv', 'detection.csv', 'verdict.csv', 'coverage.csv', 'report.md'):
                with self.subTest(name=name):
                    saved = (current / name).read_bytes()
                    self.assertEqual(saved, (output / name).read_bytes())
                    self.assertEqual(hashlib.sha256(saved).hexdigest(), context['verification']['fileSha256'][name])
        self.assertEqual(context['execution']['observations'], 906)
        self.assertTrue(context['execution']['complete'])
        self.assertTrue(context['verification']['standaloneRenderByteIdentical'])

    def test_current_result_summary_claims(self):
        current = json.loads((ROOT / 'results' / 'main-2026-11-17' / 'results.json').read_text())
        self.assertTrue(current['complete'])
        self.assertEqual(len(current['observations']), 906)
        self.assertTrue(all(item['status'] == 'success' for item in current['observations']))
        expected_verdict = {
            'rizzo': (94, 12, 4, 41),
            'horizon': (97, 7, 1, 46),
            'presidio': (78, 12, 20, 41),
        }
        for engine, expected in expected_verdict.items():
            metric = current['metrics']['verdict']['ALL'][engine]
            self.assertEqual((metric['tp'], metric['fp'], metric['fn'], metric['tn']), expected)

        catalog = set(current['catalog'])
        cases = {case['id']: case for case in current['cases']}
        expected_exact = {'rizzo': 110, 'horizon': 129, 'presidio': 103}
        for engine, expected_count in expected_exact.items():
            detections = {
                item['caseId']: item
                for item in current['observations']
                if item['engine'] == engine and item['probe'] == 'detection'
            }
            exact = 0
            for case_id, case in cases.items():
                observed = {}
                for finding in detections[case_id]['response']['findings']:
                    observed.setdefault(finding['fieldId'], set()).add(finding['category'])
                for field in case['fields']:
                    known = catalog - set(field['unknown'])
                    actual = observed.get(field['fieldId'], set()) & known
                    wanted = set(field['expected']) & known
                    exact += actual == wanted
            self.assertEqual(exact, expected_count)


if __name__ == '__main__':
    unittest.main()
