"""Real loopback HTTP and subprocess CLI tests; no detector is imported."""
import csv
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner


def case_fixture():
    return {'id': 'fixture-1', 'source': 'targeted', 'fields': [
        {'fieldId': 'description', 'text': 'Literal fixture, never inference.',
         'expected': ['PERSON'], 'unknown': ['IT_IDENTITY_CARD'], 'allowedCategories': ['PERSON']}]}


class CliTests(unittest.TestCase):
    def test_validate_only_prints_real_gold_counts_without_endpoints(self):
        completed = subprocess.run([sys.executable, str(ROOT / 'runner.py'), '--validate-only'],
                                   capture_output=True, text=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        counts = json.loads(completed.stdout)
        self.assertEqual(counts['cases'], 53)
        self.assertEqual(counts['fields'], 54)
        self.assertEqual(counts['plannedHttpRequests'], 212)
        self.assertEqual(counts['unknownPairs'], 13)
        self.assertEqual(counts['policyExpected'], {'accepted': 12, 'rejected': 41, 'unknown': 0})

    def test_full_allowlist_and_field_scoping_on_real_http(self):
        requests = []
        fixtures = [
            {'id': 'full', 'source': 'targeted', 'fields': [
                {'fieldId': 'description', 'text': 'Full policy fixture.', 'expected': ['PERSON', 'EMAIL_ADDRESS'],
                 'unknown': [], 'allowedCategories': list(runner.CATALOG)}]},
            {'id': 'partial', 'source': 'targeted', 'fields': [
                {'fieldId': 'contactName', 'text': 'Partial policy fixture.', 'expected': ['PERSON', 'EMAIL_ADDRESS'],
                 'unknown': [], 'allowedCategories': ['PERSON']},
                {'fieldId': 'eserviceDescription', 'text': 'Second field fixture.', 'expected': ['PHONE_NUMBER'],
                 'unknown': [], 'allowedCategories': []}]},
            {'id': 'wrong', 'source': 'targeted', 'fields': [
                {'fieldId': 'description', 'text': 'Wrong policy fixture.', 'expected': ['EMAIL_ADDRESS'],
                 'unknown': [], 'allowedCategories': ['PERSON']}]},
        ]
        expected = {f['text']: f['expected'] for c in fixtures for f in c['fields']}

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append(payload)
                baseline = 'allowedEntityTypes' in payload['fields'][0]
                key = 'allowedEntityTypes' if baseline else 'allowedCategories'
                findings = [{'fieldId': f['fieldId'], 'entityType' if baseline else 'category': c}
                            for f in payload['fields'] for c in expected[f['text']] if c not in f[key]]
                response = {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
                if baseline:
                    response['modelPolicyVersion'] = runner.BASELINE_VERSION
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            url = f'http://127.0.0.1:{server.server_port}'
            result = runner.collect(fixtures, {'new': url, 'baseline': url})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertTrue(result['complete'])
        self.assertEqual(len(requests), 12)
        full = [r['fields'][0] for r in requests if r['fields'][0]['text'] == 'Full policy fixture.']
        self.assertEqual(full[-1]['allowedEntityTypes'], runner.CATALOG)
        partial = [o for o in result['observations'] if o['caseId'] == 'partial' and o['probe'] == 'policy']
        self.assertTrue(all(o['findings'] == [{'fieldId': 'contactName', 'category': 'EMAIL_ADDRESS'},
                                            {'fieldId': 'eserviceDescription', 'category': 'PHONE_NUMBER'}] for o in partial))
        # Independent recount directly from observations, without production score().
        for engine in ('new', 'baseline'):
            observed = [o['rawVerdict'] for o in result['observations'] if o['engine'] == engine and o['probe'] == 'policy']
            self.assertEqual(observed, ['accepted', 'rejected', 'rejected'])
            matrix = result['metrics']['verdict']['ALL'][engine]
            self.assertEqual([matrix[k] for k in ('tp', 'fp', 'fn', 'tn')], [2, 0, 0, 1])

    def test_cli_collect_exports_and_offline_render(self):
        requests = []

        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass

            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append(body)
                field = body['fields'][0]
                baseline = 'allowedEntityTypes' in field
                allowed = field['allowedEntityTypes' if baseline else 'allowedCategories']
                key = 'entityType' if baseline else 'category'
                findings = [] if 'PERSON' in allowed else [{'fieldId': field['fieldId'], key: 'PERSON'}]
                if baseline:
                    findings.append({'fieldId': field['fieldId'], key: 'LOCATION'})
                response = {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
                if baseline:
                    response['modelPolicyVersion'] = runner.BASELINE_VERSION
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(response).encode())

        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            with tempfile.TemporaryDirectory() as temp:
                root = Path(temp)
                gold = root / 'gold.json'
                gold.write_text(json.dumps({'schemaVersion': 1, 'catalog': runner.CATALOG,
                    'frozenBeforeInference': True, 'cases': [case_fixture()]}))
                output = root / 'collected'
                url = f'http://127.0.0.1:{server.server_port}'
                command = [sys.executable, str(ROOT / 'runner.py'), '--gold', str(gold),
                    '--new-url', url, '--baseline-url', url, '--output', str(output)]
                completed = subprocess.run(command, capture_output=True, text=True)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertTrue((output / 'results.json').exists(), 'CLI must actually collect and export')
                bundle = json.loads((output / 'results.json').read_text())
                self.assertEqual(len(requests), 4)
                self.assertTrue(bundle['complete'])
                self.assertEqual(bundle['metrics']['detection']['ALL']['new']['PERSON']['tp'], 1)
                self.assertEqual(bundle['metrics']['detection']['ALL']['new']['IT_IDENTITY_CARD']['n'], 0)
                self.assertEqual(bundle['metrics']['verdict']['ALL']['baseline']['unknownExcluded'], 1)
                self.assertEqual(bundle['observations'][-1]['rawVerdict'], 'rejected')
                self.assertTrue(all(r['fields'][0]['text'] == case_fixture()['fields'][0]['text'] for r in requests))
                for path in output.iterdir():
                    self.assertNotIn(case_fixture()['fields'][0]['text'], path.read_text())
                with (output / 'detection.csv').open() as stream:
                    rows = list(csv.DictReader(stream))
                self.assertEqual(len(rows), 36)  # 2 sources (targeted/ALL), 2 engines, 9 categories
                self.assertIn('raw verdict', (output / 'report.md').read_text().lower())
                rendered = root / 'rendered'
                completed = subprocess.run([sys.executable, str(ROOT / 'runner.py'), '--render',
                    str(output / 'results.json'), '--output', str(rendered)], capture_output=True, text=True)
                self.assertEqual(completed.returncode, 0, completed.stderr)
                self.assertEqual(len(requests), 4, 'Offline render must not query HTTP')
                for path in output.iterdir():
                    self.assertEqual(path.read_bytes(), (rendered / path.name).read_bytes())
                completed = subprocess.run(command, capture_output=True, text=True)
                self.assertNotEqual(completed.returncode, 0)
                self.assertEqual(len(requests), 4, 'Existing output must fail before HTTP')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()


if __name__ == '__main__':
    unittest.main()
