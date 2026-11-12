"""Exercise the real CLI with three loopback fakes; never import detectors."""
import contextlib
import copy
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

ENGINES = ['rizzo', 'horizon', 'presidio']


def case_fixture():
    return {'id': 'fixture-1', 'source': 'targeted', 'family': 'fixture',
            'provenance': {'index': 0},
            'review': {'completeTextRead': True, 'reviewer': 'test', 'independentReview': False},
            'fields': [{'fieldId': 'description', 'text': 'Literal fixture, never inference.',
             'expected': ['PERSON'], 'unknown': ['IT_IDENTITY_CARD'], 'allowedCategories': ['PERSON']}]}


def gold_fixture(cases=None):
    return {'schemaVersion': 2, 'catalog': runner.CATALOG, 'heldout': False,
            'annotationsBeforeNewRun': True, 'cases': cases or [case_fixture()]}


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
                reply = respond(engine, payload)
                status, body = reply[:2]
                headers = reply[2] if len(reply) == 3 else {}
                raw = body if isinstance(body, bytes) else json.dumps(body).encode()
                self.send_response(status)
                for key, value in headers.items():
                    self.send_header(key, value)
                self.end_headers()
                try:
                    self.wfile.write(raw)
                except (BrokenPipeError, ConnectionResetError):
                    pass
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
            server.shutdown()
            server.server_close()
        for thread in threads:
            thread.join()


def endpoint_args(endpoints):
    return [part for e, url in endpoints.items() for part in ('--' + e + '-url', url)]


class CliTests(unittest.TestCase):
    def test_three_engine_real_cli_collect_and_standalone_render(self):
        cases = [case_fixture()]
        def respond(engine, payload):
            f = payload['fields'][0]
            self.assertEqual(set(f), {'fieldId', 'text', 'allowedCategories'})
            findings = [] if 'PERSON' in f['allowedCategories'] else [{'fieldId': f['fieldId'], 'category': 'PERSON'}]
            return 200, {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            gold = root / 'gold.json'
            gold.write_text(json.dumps(gold_fixture(cases)))
            output = root / 'collected'
            args = ['--gold', gold, *endpoint_args(endpoints), '--output', output]
            completed = cli(*args)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            bundle = json.loads((output / 'results.json').read_text())
            self.assertEqual(bundle['schemaVersion'], 2)
            self.assertEqual(bundle['engines'], ENGINES)
            self.assertEqual(len(requests), 6)
            self.assertEqual(len(bundle['observations']), 6)
            for e in ENGINES:
                wire = [p for engine, path, p in requests if engine == e]
                self.assertEqual(len(wire), 2)
                self.assertEqual(wire[0]['fields'][0]['allowedCategories'], [])
                self.assertEqual(wire[1]['fields'][0]['allowedCategories'], ['PERSON'])
                self.assertEqual(bundle['metrics']['detection']['ALL'][e]['PERSON']['tp'], 1)
                self.assertEqual(bundle['metrics']['detection']['ALL'][e]['IT_IDENTITY_CARD']['unknownExcluded'], 1)
                self.assertEqual(bundle['metrics']['verdict']['ALL'][e]['unknownExcluded'], 1)
            self.assertTrue(all(path == '/v1/analyze' for _, path, _ in requests))
            self.assertTrue(all(p['fields'][0]['text'] == cases[0]['fields'][0]['text'] for _, _, p in requests))
            self.assertNotIn('text', bundle['cases'][0]['fields'][0])
            self.assertNotIn('upstreamSpans', bundle['cases'][0]['provenance'])
            self.assertEqual(bundle['observations'][0]['response'], {'verdict': 'rejected', 'findings': [{'fieldId': 'description', 'category': 'PERSON'}]})
            with (output / 'detection.csv').open() as stream:
                self.assertEqual(len(list(csv.DictReader(stream))), 54)
            gold.unlink()
            rendered = root / 'rendered'
            completed = cli('--render', output / 'results.json', '--gold', gold, '--output', rendered)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(len(requests), 6)
            for path in output.iterdir():
                self.assertEqual(path.read_bytes(), (rendered / path.name).read_bytes())
            completed = cli('--render', output / 'results.json', '--output', output)
            self.assertEqual(completed.returncode, 3)
            self.assertEqual(len(requests), 6)


    def test_real_cli_multifield_full_partial_wrong_allowlists_and_utf16(self):
        full = case_fixture()
        full.update(id='full')
        full['fields'][0].update(expected=['PERSON', 'EMAIL_ADDRESS'], unknown=[], allowedCategories=runner.CATALOG)
        partial = case_fixture()
        partial.update(id='partial')
        partial['fields'] = [dict(full['fields'][0], fieldId='\ue000', text='First complete literal.', allowedCategories=['PERSON']),
                             dict(full['fields'][0], fieldId='\U00010000', text='Second complete literal.', expected=['PHONE_NUMBER'], allowedCategories=[])]
        wrong = case_fixture()
        wrong.update(id='wrong')
        wrong['fields'][0].update(text='Third complete literal.', expected=['EMAIL_ADDRESS'], unknown=[], allowedCategories=['PERSON'])
        cases = [full, partial, wrong]
        expected = {f['text']: f['expected'] for c in cases for f in c['fields']}
        def respond(engine, payload):
            findings = [{'fieldId': f['fieldId'], 'category': c} for f in payload['fields']
                        for c in expected[f['text']] if c not in f['allowedCategories']]
            findings.sort(key=lambda f: (f['fieldId'].encode('utf-16-be'), f['category']))
            return 200, {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            source = root / 'gold.json'
            source.write_text(json.dumps(gold_fixture(cases)))
            output = root / 'result'
            completed = cli('--gold', source, *endpoint_args(endpoints), '--output', output)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads((output / 'results.json').read_text())
            self.assertEqual(len(requests), 18)
            for e in ENGINES:
                responses = [o['response'] for o in result['observations'] if o['engine'] == e and o['probe'] == 'policy']
                self.assertEqual([r['verdict'] for r in responses], ['accepted', 'rejected', 'rejected'])
                self.assertEqual(responses[1]['findings'], [{'fieldId': '\U00010000', 'category': 'PHONE_NUMBER'},
                                                         {'fieldId': '\ue000', 'category': 'EMAIL_ADDRESS'}])
                self.assertEqual([result['metrics']['verdict']['ALL'][e][k] for k in ('tp','fp','fn','tn')], [2,0,0,1])
                sent = [p for engine, _, p in requests if engine == e]
                self.assertEqual(sent[1]['fields'][0]['allowedCategories'], runner.CATALOG)
                self.assertEqual([p for engine, _, p in requests if engine == e], [p for engine, _, p in requests if engine == 'rizzo'])
            before = len(requests)
            self.assertEqual(cli('--gold', source, *endpoint_args(endpoints), '--output', output).returncode, 3)
            self.assertEqual(len(requests), before)

    def test_cli_requires_all_three_endpoints_and_render_rejects_old_version(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            incomplete = cli('--rizzo-url', 'http://127.0.0.1:1', '--output', root / 'missing')
            self.assertEqual(incomplete.returncode, 2)
            self.assertFalse((root / 'missing').exists())
            historical = root / 'historical.json'
            historical.write_text(json.dumps({'schemaVersion': 1}))
            self.assertEqual(cli('--render', historical, '--output', root / 'out').returncode, 3)
            self.assertFalse((root / 'out').exists())


    def test_entire_merged_pilot_real_cli_source_counts_and_sanitized_projection(self):
        gold = json.loads((ROOT / 'gold.json').read_text())
        cases = gold['cases']
        oracle = {f['text']: f['expected'] for c in cases for f in c['fields']}
        def respond(engine, payload):
            findings = [{'fieldId': f['fieldId'], 'category': c} for f in payload['fields']
                        for c in oracle[f['text']] if c not in f['allowedCategories']]
            findings.sort(key=lambda f: (f['fieldId'].encode('utf-16-be'), f['category']))
            return 200, {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            output = Path(temp) / 'fake-only'
            completed = cli('--gold', ROOT / 'gold.json', *endpoint_args(endpoints), '--output', output)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            result = json.loads((output / 'results.json').read_text())
            self.assertEqual(len(requests), 546)
            self.assertEqual(len(result['observations']), 546)
            self.assertEqual(result['inventory']['ALL'], {'cases': 91, 'fields': 92, 'distinctTexts': 82, 'families': 48, 'unknownPairs': 13})
            for original, projected in zip(cases, result['cases']):
                self.assertEqual((original['id'], original['source'], original['family']),
                                 (projected['id'], projected['source'], projected['family']))
                for f, sanitized in zip(original['fields'], projected['fields']):
                    self.assertEqual({k: v for k, v in sanitized.items() if k != 'textId'},
                                     {k: v for k, v in f.items() if k != 'text'})
            for engine in ENGINES:
                sent = [payload for e, _, payload in requests if e == engine]
                expected_wire = [{'fields': [{'fieldId': f['fieldId'], 'text': f['text'],
                                               'allowedCategories': f['allowedCategories'] if policy else []}
                                              for f in c['fields']]} for c in cases for policy in [False, True]]
                self.assertEqual(sent, expected_wire)
                for source, count in [('rizzo', 10), ('gretel', 18), ('targeted', 25), ('legacy', 38), ('ALL', 91)]:
                    self.assertEqual(result['metrics']['coverage'][source][engine + '/detection']['success'], count)
                    self.assertEqual(result['metrics']['pairedSuccesses'][source], {'detection': count, 'policy': count})
                self.assertEqual(result['metrics']['detection']['ALL'][engine]['IT_IDENTITY_CARD']['unknownExcluded'], 6)
                self.assertEqual(result['metrics']['detection']['ALL'][engine]['IT_DRIVER_LICENSE']['unknownExcluded'], 7)
                # Independent verdict oracle: original fixture labels, not runner.score.
                expected_rejections = sum(any(set(f['expected']) - set(f['allowedCategories']) for f in c['fields']) for c in cases)
                observed_rejections = sum(o['response']['verdict'] == 'rejected' for o in result['observations']
                                          if o['engine'] == engine and o['probe'] == 'policy')
                self.assertEqual(expected_rejections, observed_rejections)
            for name, expected_count in [('detection', 135), ('verdict', 15), ('coverage', 30), ('observations', 546)]:
                with (output / (name + '.csv')).open() as stream:
                    rows = list(csv.DictReader(stream))
                self.assertEqual(len(rows), expected_count)
                if name == 'observations':
                    self.assertEqual([json.loads(row['response']) for row in rows], [o['response'] for o in result['observations']])


    def test_standalone_render_revalidates_wire_response_not_only_metrics(self):
        def respond(engine, payload):
            allowed = payload['fields'][0]['allowedCategories']
            findings = [{'fieldId': 'description', 'category': c} for c in ['EMAIL_ADDRESS', 'PERSON'] if c not in allowed]
            return 200, {'verdict': 'rejected', 'findings': findings}
        with fake_servers(respond) as (endpoints, requests), tempfile.TemporaryDirectory() as temp:
            result = runner.collect([case_fixture()], endpoints)
            root = Path(temp)
            for i, change in enumerate([
                lambda r: r['observations'][0]['response'].pop('verdict'),
                lambda r: r['observations'][0]['response']['findings'].reverse(),
                lambda r: r['observations'][0]['response']['findings'].append(copy.deepcopy(r['observations'][0]['response']['findings'][-1])),
                lambda r: r['observations'][0]['response'].update(modelPolicyVersion='old'),
                lambda r: r['metrics']['detection']['ALL']['rizzo']['PERSON'].update(tp=99),
            ]):
                altered = copy.deepcopy(result)
                change(altered)
                source = root / ('bad-' + str(i) + '.json')
                source.write_text(json.dumps(altered))
                output = root / ('out-' + str(i))
                self.assertEqual(cli('--render', source, '--output', output).returncode, 3)
                self.assertFalse(output.exists())
            self.assertEqual(len(requests), 6)


if __name__ == '__main__':
    unittest.main()
