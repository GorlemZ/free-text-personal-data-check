import copy
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
sys.path.insert(0, str(Path(__file__).resolve().parent))
import runner
from test_cli import case_fixture, gold_fixture


class ContractTests(unittest.TestCase):
    def test_missing_output_parent_falls_back_to_project_root(self):
        with tempfile.TemporaryDirectory() as temp:
            project_root = Path(temp)
            requested = project_root / 'missing-parent' / 'run'
            destination, create = runner.output_destination(requested, project_root)
            self.assertEqual(destination, project_root)
            self.assertFalse(create)

    def test_gold_v3_is_closed_and_canonical(self):
        good = gold_fixture()
        runner.validate_gold(good)
        mutations = [
            lambda g: g.update(extra=True),
            lambda g: g.update(schemaVersion=2),
            lambda g: g.update(goldVersion='other'),
            lambda g: g.update(catalog=list(reversed(runner.CATALOG))),
            lambda g: g['cases'][0].update(source='removed'),
            lambda g: g['cases'][0].update(id=''),
            lambda g: g['cases'][0].update(text=''),
            lambda g: g['cases'][0].update(expected=['PERSON','PERSON']),
            lambda g: g['cases'][0].update(expected=['WRONG']),
            lambda g: g['cases'][0].update(expected=['EMAIL_ADDRESS','PERSON']),
            lambda g: g['cases'].append(copy.deepcopy(g['cases'][0])),
        ]
        with patch.object(runner, 'open_http', side_effect=AssertionError('No HTTP')):
            for change in mutations:
                bad = copy.deepcopy(good); change(bad)
                with self.subTest(change=change), self.assertRaises(ValueError):
                    runner.validate_gold(bad)

    def test_wire_order_is_utf16_while_golden_order_is_catalog(self):
        case = case_fixture(expected=['PERSON','EMAIL_ADDRESS'])
        good = {'verdict':'rejected','findings':[
            {'fieldId':'text','category':'EMAIL_ADDRESS'},
            {'fieldId':'text','category':'PERSON'}]}
        projected = runner.project_response(good)
        self.assertEqual(projected, ['PERSON','EMAIL_ADDRESS'])
        for bad in [
            {'verdict':'rejected','findings':list(reversed(good['findings']))},
            {'verdict':'rejected','findings':[good['findings'][0],good['findings'][0]]},
            {'verdict':'accepted','findings':good['findings']},
            {'verdict':'rejected','findings':[{'fieldId':'wrong','category':'PERSON'}]},
            {'verdict':'rejected','findings':[{'fieldId':'text','category':'LOCATION'}]},
            {'verdict':'rejected','findings':good['findings'],'extra':True},
        ]:
            with self.subTest(bad=bad), self.assertRaises(ValueError):
                runner.project_response(bad)

    def test_result_bundle_is_closed_complete_and_derived_flags_are_consistent(self):
        cases = [case_fixture()]
        endpoints = {e:'http://127.0.0.1:1' for e in runner.ENGINES}
        response = {'verdict':'rejected','findings':[{'fieldId':'text','category':'PERSON'}]}
        class Reply:
            status=200
            def __enter__(self): return self
            def __exit__(self,*args): return False
            def read(self,n): return __import__('json').dumps(response).encode()
        with patch.object(runner, 'open_http', return_value=Reply()):
            result = runner.collect(cases, endpoints)
        runner.validate_result(result)
        mutations = [
            lambda r:r.update(extra=True), lambda r:r.update(schemaVersion=2),
            lambda r:r['observations'].pop(),
            lambda r:r['observations'].append(copy.deepcopy(r['observations'][0])),
            lambda r:r['observations'][0].update(bodyExact=False),
            lambda r:r['observations'][0].update(verdictCorrect=False),
            lambda r:r['observations'][0].update(observedVerdict='accepted',verdictCorrect=False,bodyExact=False),
            lambda r:r['observations'][0].update(observedCategories=['PERSON','PERSON']),
        ]
        for change in mutations:
            bad=copy.deepcopy(result); change(bad)
            with self.subTest(change=change), self.assertRaises(ValueError):
                runner.validate_result(bad)


if __name__ == '__main__': unittest.main()
