"""Read-only static-gold checks, not a dataset producer or parquet prerequisite."""
import copy
import contextlib
import io
import hashlib
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner
from test_cli import cli


class PreflightTests(unittest.TestCase):
    def test_aliasit_source_is_accepted_without_leaking_editorial_provenance(self):
        gold = json.loads((ROOT / 'gold.json').read_text())
        case = copy.deepcopy(gold['cases'][0])
        case.update(id='aliasit-fixture', source='aliasit', family='aliasit-fixture-family')
        case['provenance'] = {'row': 3, 'split': 'test', 'revision': 'pinned-source',
                              'upstreamTextReconstruction': 'editorial note, not result data'}
        runner.validate_cases([case])
        projected = runner.project_cases([case])
        runner.validate_cases(projected, with_text=False)
        self.assertEqual(projected[0]['provenance'], {'row': 3, 'split': 'test', 'revision': 'pinned-source'})

    def test_single_static_gold_preserves_adjudicated_original_and_counts_selected_imports(self):
        gold = json.loads((ROOT / 'gold.json').read_text())
        runner.validate_gold(gold)
        original = gold['cases'][:53]
        self.assertEqual(hashlib.sha256(json.dumps(original, sort_keys=True, ensure_ascii=False).encode()).hexdigest(),
                         'defa8d69faa59918e0bda23628bb8ee70cd0a461bc126fee460f26578e3a9d58')
        self.assertEqual(len({f['text'] for c in original for f in c['fields']}), 54)
        counts = runner.gold_counts(gold)
        self.assertEqual((counts['cases'], counts['fields'], counts['distinctTexts']), (151, 152, 142))
        self.assertEqual(counts['plannedHttpRequests'], 906)
        self.assertEqual(counts['unknownPairs'], 0)
        self.assertEqual(counts['sources']['legacy']['cases'], 38)
        self.assertEqual(counts['sources']['legacy']['distinctTexts'], 28)
        self.assertEqual({s: counts['sources'][s]['cases'] for s in runner.SOURCES},
                         {'rizzo': 10, 'gretel': 48, 'targeted': 25, 'legacy': 38, 'aliasit': 30})
        self.assertFalse((ROOT / 'prepare_gold.py').exists())
        self.assertFalse((ROOT / 'baseline-capabilities.json').exists())
        self.assertFalse((ROOT / 'targeted-texts.json').exists())
        before = (ROOT / 'gold.json').read_bytes()
        with patch.object(runner, 'open_http', side_effect=AssertionError('No HTTP')), contextlib.redirect_stdout(io.StringIO()):
            self.assertEqual(runner.main(['--validate-only']), 0)
        self.assertEqual(before, (ROOT / 'gold.json').read_bytes())
        result = cli('--validate-only')
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), counts)

    def test_legacy_provenance_and_manual_current_goal_review(self):
        gold = json.loads((ROOT / 'gold.json').read_text())
        cases = [c for c in gold['cases'] if c['source'] == 'legacy']
        self.assertEqual(len(cases), 38)
        self.assertEqual(gold['mergedReview']['distinctTextsRead'], 142)
        self.assertEqual(gold['mergedReview']['casesReviewed'], 151)
        for c in cases:
            p = c['provenance']
            self.assertEqual(p['revision'], '38360c8d7f776c075457e319bd957502a03c963b')
            self.assertEqual(c['id'], 'legacy-' + p['sourceCaseId'])
            self.assertEqual(c['family'], 'legacy-' + p['familyId'])
            self.assertIs(type(p['textIndex']), int)
            self.assertTrue(p['selectionRationale'])
            self.assertTrue(c['review']['note'])
        for case_id, category in [('it-fiscal-code-negative-02', 'IT_FISCAL_CODE'),
                                  ('it-vat-code-negative-03', 'IT_VAT_CODE'),
                                  ('iban-code-negative-02', 'IBAN_CODE'),
                                  ('credit-card-negative-03', 'CREDIT_CARD')]:
            c = next(c for c in cases if c['id'] == 'legacy-' + case_id)
            self.assertEqual(c['fields'][0]['expected'], [category])
            self.assertEqual(runner.expected_verdict(c), 'rejected')
        bad = copy.deepcopy(gold)
        next(c for c in bad['cases'] if c['source'] == 'legacy')['provenance'].pop('sourceCaseId')
        with self.assertRaises(ValueError):
            runner.validate_gold(bad)


    def test_preflight_rejects_drifted_review_counts_and_duplicate_text_annotations(self):
        good = json.loads((ROOT / 'gold.json').read_text())
        changes = [lambda g: g['mergedReview'].update(distinctTextsRead=1),
                   lambda g: g['mergedReview'].update(fieldCategoryDecisions=1),
                   lambda g: g['sourceFiles']['legacy'].update(selectedCases=1),
                   lambda g: g['cases'][54]['fields'][0].update(expected=[])]
        for change in changes:
            bad = copy.deepcopy(good)
            change(bad)
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.validate_gold(bad)


if __name__ == '__main__':
    unittest.main()
