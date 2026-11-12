"""Operational receipts: no failure is silently scored as a negative."""
import copy
import json
from pathlib import Path
import sys
import tempfile
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner
from test_cli import case_fixture, gold_fixture, fake_servers, endpoint_args, cli, ENGINES


class FailureTests(unittest.TestCase):
    def test_cli_http_failures_and_invalid_responses_keep_partial_receipt(self):
        modes = [('400', 'HTTP_400', 'technical_failure'), ('503', 'HTTP_503', 'technical_failure'),
                 ('201', 'HTTP_201', 'technical_failure'), ('302', 'HTTP_302', 'technical_failure'), ('json', 'INVALID_JSON', 'contract_failure'),
                 ('version', 'RESPONSE_SCHEMA', 'contract_failure'),
                 ('duplicate-key', 'DUPLICATE_JSON_KEY', 'contract_failure'),
                 ('extra', 'UNKNOWN_CATEGORY', 'contract_failure'),
                 ('duplicate-finding', 'DUPLICATE_FINDING', 'contract_failure'),
                 ('order', 'FINDING_ORDER', 'contract_failure'),
                 ('timeout', 'TRANSPORT_ERROR', 'technical_failure'),
                 ('broken-chunk', 'TRANSPORT_ERROR', 'technical_failure'),
                 ('utf8', 'INVALID_JSON', 'contract_failure'),
                 ('large', 'RESPONSE_TOO_LARGE', 'contract_failure')]
        for mode, error, status in modes:
            def respond(engine, payload):
                if engine != 'horizon':
                    return 200, {'verdict': 'accepted', 'findings': []}
                if mode == '302':
                    return 302, {}, {'Location': '/redirect-target'}
                if mode == 'timeout':
                    time.sleep(.2)
                if mode == 'broken-chunk':
                    return 200, b'NOT-HEX\r\n', {'Transfer-Encoding': 'chunked'}
                if mode == 'utf8':
                    return 200, b'\xff'
                if mode == 'large':
                    return 200, b'x' * 1_000_001
                if mode == 'json':
                    return 200, b'INVALID SECRET RESPONSE'
                if mode == 'duplicate-key':
                    return 200, b'{"verdict":"rejected","verdict":"accepted","findings":[]}'
                body = {'verdict': 'accepted', 'findings': []}
                if mode == 'version':
                    body['modelPolicyVersion'] = 'legacy'
                if mode in ('extra', 'duplicate-finding', 'order'):
                    categories = {'extra': ['LOCATION'], 'duplicate-finding': ['EMAIL_ADDRESS', 'EMAIL_ADDRESS'],
                                  'order': ['PHONE_NUMBER', 'EMAIL_ADDRESS']}[mode]
                    body = {'verdict': 'rejected', 'findings': [{'fieldId': 'description', 'category': c} for c in categories]}
                return int(mode) if mode in ('400', '503', '201') else 200, body
            with self.subTest(mode=mode), fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                gold = root / 'gold.json'
                gold.write_text(json.dumps(gold_fixture()))
                output = root / 'collected'
                completed = cli('--gold', gold, *endpoint_args(endpoints), '--timeout', '.05' if mode == 'timeout' else '2', '--output', output)
                self.assertEqual(completed.returncode, 2, completed.stderr)
                result = json.loads((output / 'results.json').read_text())
                self.assertFalse(result['complete'])
                self.assertEqual(len(result['observations']), 6)
                self.assertEqual(len(requests), 6)
                failures = [o for o in result['observations'] if o['engine'] == 'horizon']
                self.assertEqual([(o['status'], o.get('errorCode')) for o in failures], [(status, error)] * 2)
                for e in ENGINES:
                    self.assertEqual(result['metrics']['detection']['ALL'][e]['PERSON']['n'], 0)
                self.assertEqual(result['metrics']['coverage']['ALL']['rizzo/detection']['success'], 1)
                self.assertEqual(result['metrics']['coverage']['ALL']['horizon/detection'][status], 1)
                self.assertNotIn('SECRET', json.dumps(result))
                completed = cli('--render', output / 'results.json', '--output', root / 'rendered')
                self.assertEqual(completed.returncode, 2)
                self.assertEqual(len(requests), 6)
                for path in output.iterdir():
                    self.assertEqual(path.read_bytes(), (root / 'rendered' / path.name).read_bytes())

    def test_interrupt_records_current_failure_and_remaining_unattempted(self):
        with patch.object(runner, 'open_http', side_effect=KeyboardInterrupt):
            result = runner.collect([case_fixture()], {e: 'http://127.0.0.1:1' for e in ENGINES})
        self.assertFalse(result['complete'])
        self.assertEqual([o['status'] for o in result['observations']], ['technical_failure'] + ['unattempted'] * 5)
        self.assertEqual(result['observations'][0]['errorCode'], 'INTERRUPTED')
        runner.validate_result(result)
        with tempfile.TemporaryDirectory() as temp:
            runner.write_reports(result, Path(temp))
            self.assertEqual(json.loads((Path(temp) / 'results.json').read_text())['metrics']['pairedSuccesses']['ALL'], {'detection': 0, 'policy': 0})

    def test_policy_failure_keeps_detection_pairs_and_own_successes(self):
        def respond(engine, payload):
            allowed = payload['fields'][0]['allowedCategories']
            if allowed and engine == 'presidio':
                return 503, {'code': 'detector_unavailable'}
            findings = [] if allowed else [{'fieldId': 'description', 'category': 'PERSON'}]
            return 200, {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests):
            result = runner.collect([case_fixture()], endpoints)
        self.assertEqual(len(requests), 6)
        self.assertEqual(result['metrics']['detection']['ALL']['rizzo']['PERSON']['tp'], 1)
        self.assertEqual(result['metrics']['verdict']['ALL']['rizzo']['n'], 0)
        self.assertEqual(result['metrics']['coverage']['ALL']['rizzo/policy']['success'], 1)
        self.assertEqual(result['metrics']['pairedSuccesses']['ALL'], {'detection': 1, 'policy': 0})
        runner.validate_result(result)

    def test_cli_write_failure_is_nonzero_and_does_not_log_raw_error(self):
        with patch.object(runner, 'open_http', side_effect=OSError()):
            result = runner.collect([case_fixture()], {e: 'http://127.0.0.1:1' for e in ENGINES})
        with tempfile.TemporaryDirectory() as temp:
            source = Path(temp) / 'result.json'
            source.write_text(json.dumps(result))
            with patch.object(Path, 'write_text', side_effect=OSError('SENSITIVE ERROR')):
                with patch.object(runner.sys, 'stderr') as stderr:
                    code = runner.main(['--render', str(source), '--output', str(Path(temp) / 'output')])
            self.assertEqual(code, 3)
            self.assertNotIn('SENSITIVE', str(stderr.mock_calls))


if __name__ == '__main__':
    unittest.main()
