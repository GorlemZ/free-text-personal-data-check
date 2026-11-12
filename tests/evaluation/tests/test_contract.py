import copy
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner
from test_cli import case_fixture, gold_fixture, ENGINES


class ContractTests(unittest.TestCase):
    def test_raw_findings_must_be_unique_and_utf16_ordered_before_projection(self):
        case = case_fixture()
        case['fields'] = [dict(case['fields'][0], fieldId=fid) for fid in ['\ue000', '\U00010000']]
        good = {'verdict': 'rejected', 'findings': [
            {'fieldId': '\U00010000', 'category': 'EMAIL_ADDRESS'},
            {'fieldId': '\U00010000', 'category': 'PERSON'},
            {'fieldId': '\ue000', 'category': 'PERSON'}]}
        runner.validate_cases([case])
        self.assertEqual(runner.project_response(good, case)['response'], good)
        reverse = dict(good, findings=list(reversed(good['findings'])))
        with self.assertRaisesRegex(ValueError, 'FINDING_ORDER'):
            runner.project_response(reverse, case)
        duplicate = dict(good, findings=[good['findings'][0], good['findings'][0]])
        with self.assertRaisesRegex(ValueError, 'DUPLICATE_FINDING'):
            runner.project_response(duplicate, case)
        same_field_reverse = dict(good, findings=[good['findings'][1], good['findings'][0]])
        with self.assertRaisesRegex(ValueError, 'FINDING_ORDER'):
            runner.project_response(same_field_reverse, case)

    def test_gold_preflight_rejects_bad_inputs_without_http(self):
        good = gold_fixture()
        mutations = [lambda g: g.update(annotationsBeforeNewRun=False),
                     lambda g: g['cases'].append(copy.deepcopy(g['cases'][0])),
                     lambda g: g['cases'][0]['fields'].extend([copy.deepcopy(g['cases'][0]['fields'][0])] * 10),
                     lambda g: g['cases'][0]['fields'][0].update(text='word ' * 51),
                     lambda g: g['cases'][0]['fields'][0].update(expected=['WRONG']),
                     lambda g: g['cases'][0]['fields'][0].update(unknown=['PERSON']),
                     lambda g: g['cases'][0]['fields'][0].update(allowedCategories=['PERSON', 'PERSON']),
                     lambda g: g['cases'][0]['fields'][0].update(text='\ud800'),
                     lambda g: g['cases'][0]['fields'][0].update(fieldId='\U00010000' * 65),
                     lambda g: g['cases'][0]['fields'][0].update(extra='not-schema')]
        with patch.object(runner, 'open_http', side_effect=AssertionError('No HTTP')):
            for change in mutations:
                gold = copy.deepcopy(good)
                change(gold)
                with self.subTest(change=change), self.assertRaises(ValueError):
                    runner.validate_gold(gold)
            runner.validate_gold(good)

    def test_unicode_word_count_is_contract_white_space_not_python_split(self):
        c = case_fixture()
        for separator in ['\u0085', '\u2000', '\u202f', '\u3000']:
            c['fields'][0]['text'] = separator.join(['word'] * 51)
            with self.assertRaisesRegex(ValueError, 'TEXT_LIMIT'):
                runner.validate_cases([c])
        c['fields'][0]['text'] = '\u001c'.join(['word'] * 51)
        runner.validate_cases([c])  # U+001C is not Unicode White_Space.
        c['fields'][0]['text'] = ''
        c['fields'][0]['fieldId'] = '\U00010000' * 64
        runner.validate_cases([c])

    def test_extra_native_labels_are_contract_failures_not_filtered(self):
        for label in ['LOCATION', 'NATIONAL_ID', 'EMAIL', 'UNKNOWN']:
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, 'UNKNOWN_CATEGORY'):
                runner.project_response({'verdict': 'rejected', 'findings': [{'fieldId': 'description', 'category': label}]}, case_fixture())

    def test_allowed_findings_and_invalid_response_shapes_are_rejected(self):
        case = case_fixture()
        valid = {'verdict': 'accepted', 'findings': []}
        with self.assertRaisesRegex(ValueError, 'ALLOWED_FINDING'):
            runner.project_response({'verdict': 'rejected', 'findings': [{'fieldId': 'description', 'category': 'PERSON'}]}, case, 'policy')
        invalid = [None, [], dict(valid, secret='untrusted'), dict(valid, verdict='unknown'),
                   dict(valid, findings=[{'fieldId': 'wrong', 'category': 'PERSON'}]),
                   dict(valid, verdict='rejected'), dict(valid, modelPolicyVersion='old'),
                   dict(valid, findings=[{'fieldId': 'description', 'entityType': 'PERSON'}])]
        for response in invalid:
            with self.subTest(response=response), self.assertRaises(ValueError):
                runner.project_response(response, case)

    def test_unknown_not_tn_and_known_forbidden_controls_verdict(self):
        case = case_fixture()
        self.assertIsNone(runner.expected_verdict(case))
        case['fields'][0]['allowedCategories'] = []
        self.assertEqual(runner.expected_verdict(case), 'rejected')
        case['fields'][0]['allowedCategories'] = ['PERSON', 'IT_IDENTITY_CARD']
        self.assertEqual(runner.expected_verdict(case), 'accepted')

    def test_bundle_is_closed_self_contained_and_current_version_only(self):
        with patch.object(runner, 'open_http', side_effect=OSError()):
            result = runner.collect([case_fixture()], {e: 'http://127.0.0.1:1' for e in ENGINES})
        runner.validate_result(result)
        for change in [lambda r: r['cases'][0]['fields'][0].update(text='never export'),
                       lambda r: r['cases'][0].update(focusCategory='PERSON'),
                       lambda r: r['cases'][0]['provenance'].update(upstreamSpans=[]),
                       lambda r: r['observations'].pop(),
                       lambda r: r['observations'].append(copy.deepcopy(r['observations'][0])),
                       lambda r: r.update(complete=True),
                       lambda r: r.update(schemaVersion=1),
                       lambda r: r.update(catalog=['PERSON']),
                       lambda r: r['inventory']['ALL'].update(cases=0),
                       lambda r: r['engines'].pop()]:
            bad = copy.deepcopy(result)
            change(bad)
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.validate_result(bad)


    def test_failure_status_and_error_code_cannot_contradict_each_other(self):
        with patch.object(runner, 'open_http', side_effect=OSError()):
            result = runner.collect([case_fixture()], {e: 'http://127.0.0.1:1' for e in ENGINES})
        for status, code in [('success', 'TRANSPORT_ERROR'), ('unattempted', 'HTTP_503'),
                             ('technical_failure', 'DUPLICATE_FINDING'), ('contract_failure', 'HTTP_503')]:
            bad = copy.deepcopy(result)
            bad['observations'][0].update(status=status, errorCode=code)
            # Recalculate metrics so the status/code assertion itself is exercised.
            if status != 'success':
                bad['metrics'] = runner.score(bad)
            with self.subTest(status=status, code=code), self.assertRaises(ValueError):
                runner.validate_result(bad)


if __name__ == '__main__':
    unittest.main()
