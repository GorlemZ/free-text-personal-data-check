import copy
import json
from pathlib import Path
import sys
import tempfile
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner
from test_cli import case_fixture


class FailureTests(unittest.TestCase):
    def test_interrupt_records_current_failure_and_remaining_unattempted(self):
        with patch.object(runner.urllib.request, 'urlopen', side_effect=KeyboardInterrupt):
            try:
                result = runner.collect([case_fixture()], {'new': 'http://127.0.0.1:1', 'baseline': 'http://127.0.0.1:1'})
            except KeyboardInterrupt:
                self.fail('Collector lost the interrupted-run receipt')
        self.assertFalse(result['complete'])
        self.assertEqual([o['status'] for o in result['observations']],
                         ['technical_failure', 'unattempted', 'unattempted', 'unattempted'])
        self.assertEqual(result['observations'][0]['errorCode'], 'INTERRUPTED')
        runner.validate_result(result)
        with tempfile.TemporaryDirectory() as temp:
            runner.write_reports(result, Path(temp))
            self.assertEqual(json.loads((Path(temp) / 'results.json').read_text())['metrics']['pairedSuccesses']['ALL'],
                             {'detection': 0, 'policy': 0})

    def test_http_failures_do_not_become_negative_predictions(self):
        state = {'mode': '400'}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                mode = state['mode']
                if mode == 'timeout':
                    time.sleep(0.15)
                status = int(mode) if mode in ('400', '503') else 200
                data = {'verdict': 'accepted', 'findings': [], 'modelPolicyVersion': runner.BASELINE_VERSION}
                if mode == 'version':
                    data['modelPolicyVersion'] = 'WRONG'
                raw = json.dumps(data).encode()
                if mode == 'json':
                    raw = b'INVALID SECRET RESPONSE'
                if mode == 'duplicate':
                    raw = b'{"verdict":"rejected","verdict":"accepted","findings":[],"modelPolicyVersion":"it-spacy-sm-3.8.0-poc1"}'
                self.send_response(status)
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            for mode, error in [('400', 'HTTP_400'), ('503', 'HTTP_503'), ('json', 'INVALID_JSON'),
                                ('version', 'VERSION_MISMATCH'), ('duplicate', 'DUPLICATE_JSON_KEY'),
                                ('timeout', 'TRANSPORT_ERROR')]:
                state['mode'] = mode
                with self.subTest(mode=mode):
                    result = runner.collect([case_fixture()], {'baseline': f'http://127.0.0.1:{server.server_port}'},
                                            timeout=0.03 if mode == 'timeout' else 2)
                    self.assertFalse(result['complete'])
                    self.assertTrue(all(o.get('errorCode') == error for o in result['observations']))
                    self.assertEqual(result['metrics']['detection']['ALL']['baseline']['PERSON']['n'], 0)
                    self.assertNotIn('SECRET', json.dumps(result))
                    runner.validate_result(result)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_policy_failure_keeps_successful_detection_pairs(self):
        result = {'schemaVersion': 1, 'catalog': runner.CATALOG, 'engines': ['new', 'baseline'],
                  'baselineCapabilities': runner.load_capabilities(),
                  'cases': [case_fixture()], 'observations': [], 'complete': False}
        del result['cases'][0]['fields'][0]['text']
        for probe in ('detection', 'policy'):
            for engine in result['engines']:
                observation = {'caseId': 'fixture-1', 'engine': engine, 'probe': probe}
                if probe == 'policy':
                    observation.update(status='technical_failure', errorCode='HTTP_503')
                else:
                    observation.update(status='success', rawVerdict='rejected', findings=[{'fieldId': 'description', 'category': 'PERSON'}],
                                       extras=[], modelPolicyVersion=runner.BASELINE_VERSION if engine == 'baseline' else None)
                result['observations'].append(observation)
        result['metrics'] = runner.score(result)
        runner.validate_result(result)
        self.assertEqual(result['metrics']['detection']['ALL']['new']['PERSON']['tp'], 1)
        self.assertEqual(result['metrics']['verdict']['ALL']['new']['n'], 0)
        self.assertEqual(result['metrics']['pairedSuccesses']['ALL'], {'detection': 1, 'policy': 0})

    def test_cli_write_failure_is_nonzero_and_does_not_log_raw_error(self):
        with patch.object(runner.urllib.request, 'urlopen', side_effect=OSError()):
            result = runner.collect([case_fixture()], {'new': 'http://127.0.0.1:1'})
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
