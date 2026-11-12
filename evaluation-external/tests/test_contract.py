import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner
from test_cli import case_fixture


class ContractTests(unittest.TestCase):
    def test_gold_preflight_rejects_bad_inputs_without_http(self):
        self.assertTrue(callable(getattr(runner, 'validate_gold', None)), 'Gold preflight is missing')
        good = {'schemaVersion': 1, 'catalog': runner.CATALOG,
                'frozenBeforeInference': True, 'cases': [case_fixture()]}
        mutations = [
            lambda g: g.update(frozenBeforeInference=False),
            lambda g: g['cases'].append(copy.deepcopy(g['cases'][0])),
            lambda g: g['cases'][0]['fields'].extend([copy.deepcopy(g['cases'][0]['fields'][0])] * 10),
            lambda g: g['cases'][0]['fields'][0].update(text='word ' * 51),
            lambda g: g['cases'][0]['fields'][0].update(expected=['WRONG']),
            lambda g: g['cases'][0]['fields'][0].update(unknown=['PERSON']),
            lambda g: g['cases'][0]['fields'][0].update(allowedCategories=['PERSON', 'PERSON']),
        ]
        with patch.object(runner.urllib.request, 'urlopen', side_effect=AssertionError('No HTTP')):
            for change in mutations:
                gold = copy.deepcopy(good)
                change(gold)
                with self.subTest(change=change), self.assertRaises(ValueError):
                    runner.validate_gold(gold)
            runner.validate_gold(good)

    def test_parent_capabilities_are_explicit_and_complete(self):
        capabilities = runner.load_capabilities(ROOT / 'baseline-capabilities.json')
        self.assertEqual(capabilities['evidence']['kind'], 'parent-provided-runtime')
        self.assertEqual(capabilities['modelPolicyVersion'], runner.BASELINE_VERSION)
        self.assertEqual(len(capabilities['supportedEntities']), 18)
        self.assertEqual(capabilities['nativeToCategory'], {c: c for c in runner.CATALOG})
        case = case_fixture()
        case['fields'][0]['allowedCategories'] = runner.CATALOG
        self.assertEqual(runner.payload_for(case, 'baseline', 'policy', capabilities)['fields'][0]['allowedEntityTypes'], runner.CATALOG)
        missing = copy.deepcopy(capabilities)
        missing['supportedEntities'].remove('IT_IDENTITY_CARD')
        missing['nativeToCategory'].pop('IT_IDENTITY_CARD')
        payload = runner.payload_for(case, 'baseline', 'policy', missing)
        self.assertNotIn('IT_IDENTITY_CARD', payload['fields'][0]['allowedEntityTypes'])
        self.assertEqual(len(payload['fields'][0]['allowedEntityTypes']), 8)
        bad = copy.deepcopy(capabilities)
        bad['nativeToCategory']['PERSON'] = 'EMAIL_ADDRESS'
        with self.assertRaises(ValueError):
            runner.validate_capabilities(bad)

    def test_allowlisted_findings_are_contract_failure(self):
        case = case_fixture()
        body = {'verdict': 'rejected', 'findings': [{'fieldId': 'description', 'category': 'PERSON'}]}
        runner.project_response(body, case, 'new', probe='detection')
        with self.assertRaisesRegex(ValueError, 'ALLOWED_FINDING'):
            runner.project_response(body, case, 'new', probe='policy')

    def test_invalid_response_shapes_are_rejected(self):
        valid = {'verdict': 'accepted', 'findings': []}
        invalid = [None, [], dict(valid, secret='untrusted'), dict(valid, verdict='unknown'),
            dict(valid, findings=[{'fieldId': 'wrong', 'category': 'PERSON'}]),
            dict(valid, verdict='rejected'),
            dict(valid, findings=[{'fieldId': 'description', 'category': 'OTHER'}])]
        for response in invalid:
            with self.subTest(response=response), self.assertRaises(ValueError):
                runner.project_response(response, case_fixture(), 'new')

    def test_unknown_not_tn_and_known_forbidden_controls_verdict(self):
        case = case_fixture()
        self.assertIsNone(runner.expected_verdict(case))
        case['fields'][0]['allowedCategories'] = []
        self.assertEqual(runner.expected_verdict(case), 'rejected')
        case['fields'][0]['allowedCategories'] = ['PERSON', 'IT_IDENTITY_CARD']
        self.assertEqual(runner.expected_verdict(case), 'accepted')

    def test_saved_bundle_rejects_mutated_shape_and_missing_observations(self):
        # No detector: the transport is intentionally unavailable for every planned request.
        with patch.object(runner.urllib.request, 'urlopen', side_effect=OSError()):
            result = runner.collect([case_fixture()], {'new': 'http://127.0.0.1:1'})
        runner.validate_result(result)
        for change in [lambda r: r['cases'][0]['fields'][0].update(text='never export'),
                       lambda r: r['observations'].pop(),
                       lambda r: r['observations'].append(copy.deepcopy(r['observations'][0])),
                       lambda r: r.update(complete=True),
                       lambda r: r.update(catalog=['PERSON'])]:
            bad = copy.deepcopy(result)
            change(bad)
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.validate_result(bad)


if __name__ == '__main__':
    unittest.main()
