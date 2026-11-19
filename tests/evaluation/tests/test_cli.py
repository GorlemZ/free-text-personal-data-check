"""Golden v3 CLI tests with loopback HTTP fakes only."""
import contextlib
import csv
import json
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
import subprocess
import sys
import tempfile
import threading
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner

ENGINES = ['bardsai']


def case_fixture(case_id='fixture-1', expected=None):
    return {'id': case_id, 'text': 'La referente è Giulia Bianchi.',
            'expected': ['PERSON'] if expected is None else expected}


def gold_fixture(cases=None):
    return {'schemaVersion': 3, 'goldVersion': 'category-detection-1',
            'catalog': runner.CATALOG, 'cases': cases or [case_fixture()]}


def cli(*args):
    return subprocess.run([sys.executable, str(ROOT / 'runner.py'), *map(str, args)],
                          capture_output=True, text=True, timeout=30)


@contextlib.contextmanager
def fake_servers(respond):
    requests, servers, threads = [], [], []
    def handler(engine):
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, format, *args):
                pass
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append((engine, self.path, payload))
                status, body = respond(engine, payload)
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                self.end_headers()
                self.wfile.write(raw)
        return Handler
    try:
        for engine in ENGINES:
            server = ThreadingHTTPServer(('127.0.0.1', 0), handler(engine))
            thread = threading.Thread(target=server.serve_forever, kwargs={'poll_interval': .01}, daemon=True)
            thread.start()
            servers.append(server)
            threads.append(thread)
        yield {e: f'http://127.0.0.1:{s.server_port}' for e, s in zip(ENGINES, servers)}, requests
    finally:
        for server in servers:
            server.shutdown(); server.server_close()
        for thread in threads:
            thread.join()


def endpoint_args(endpoints):
    return [part for e, url in endpoints.items() for part in ('--' + e + '-url', url)]


class CliTests(unittest.TestCase):
    def test_one_deny_all_post_per_case_engine_and_standalone_render(self):
        cases = [case_fixture(), case_fixture('negative', [])]
        oracle = {c['text']: c['expected'] for c in cases}
        cases[1]['text'] = 'La manutenzione è prevista domani.'
        oracle = {c['text']: c['expected'] for c in cases}
        def respond(engine, payload):
            field = payload['fields'][0]
            self.assertEqual(field['fieldId'], 'text')
            self.assertEqual(field['allowedCategories'], [])
            categories = oracle[field['text']]
            findings = [{'fieldId': 'text', 'category': c} for c in
                        sorted(categories, key=lambda c: c.encode('utf-16-be'))]
            return 200, {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            root = Path(temp); gold = root / 'gold.json'; output = root / 'collected'
            gold.write_text(json.dumps(gold_fixture(cases)))
            completed = cli('--gold', gold, *endpoint_args(endpoints), '--output', output)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads((output / 'results.json').read_text())
            self.assertEqual(set(result), {'schemaVersion','goldVersion','catalog','engines','caseCount','observations'})
            self.assertEqual(result['schemaVersion'], 3)
            self.assertEqual(result['caseCount'], 2)
            self.assertEqual(len(requests), 2)
            self.assertEqual(len(result['observations']), 2)
            self.assertNotIn('text', json.dumps(result))
            rendered = root / 'rendered'
            completed = cli('--render', output / 'results.json', '--output', rendered)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            for path in output.iterdir():
                self.assertEqual(path.read_bytes(), (rendered / path.name).read_bytes())
            with (output / 'category.csv').open() as stream:
                self.assertEqual(len(list(csv.DictReader(stream))), 9)

    def test_full_checked_in_gold_uses_exactly_142_posts(self):
        gold = json.loads((ROOT / 'gold.json').read_text())
        oracle = {c['text']: c['expected'] for c in gold['cases']}
        def respond(engine, payload):
            categories = oracle[payload['fields'][0]['text']]
            findings = [{'fieldId': 'text', 'category': c} for c in
                        sorted(categories, key=lambda c: c.encode('utf-16-be'))]
            return 200, {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'result'
            completed = cli('--gold', ROOT / 'gold.json', *endpoint_args(endpoints), '--output', output)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads((output / 'results.json').read_text())
            self.assertEqual(len(gold['cases']), 142)
            self.assertEqual(len(requests), 142)
            self.assertEqual(len(result['observations']), 142)
            self.assertTrue(all(o['bodyExact'] and o['verdictCorrect'] for o in result['observations']))
            expected_requests = [(engine, '/v1/analyze', {'fields': [{
                'fieldId': 'text', 'text': case['text'], 'allowedCategories': []}]})
                for case in gold['cases'] for engine in ENGINES]
            self.assertEqual(requests, expected_requests)

    def test_existing_output_is_rejected_before_any_http_request(self):
        def respond(engine, payload):
            self.fail('HTTP must not run when output already exists')
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            root = Path(temp); gold = root / 'gold.json'; output = root / 'existing'
            gold.write_text(json.dumps(gold_fixture()))
            output.mkdir()
            completed = cli('--gold', gold, *endpoint_args(endpoints), '--output', output)
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(requests, [])

    def test_broken_output_symlink_is_rejected_before_any_http_request(self):
        def respond(engine, payload):
            self.fail('HTTP must not run when output is a broken symlink')
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            root = Path(temp); gold = root / 'gold.json'; output = root / 'broken-link'
            gold.write_text(json.dumps(gold_fixture()))
            output.symlink_to(root / 'missing-target', target_is_directory=True)
            completed = cli('--gold', gold, *endpoint_args(endpoints), '--output', output)
            self.assertNotEqual(completed.returncode, 0)
            self.assertEqual(requests, [])


if __name__ == '__main__':
    unittest.main()
