import copy
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / 'tests/resources'))


def harness():
    import run
    return run


class Integration(unittest.TestCase):
    def test_central_runner_selects_only_fake_suite(self):
        spec = importlib.util.spec_from_file_location('central_test_runner', ROOT / 'tests/run.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        self.assertIn('resources', module.SUITES, 'resources suite not integrated')
        self.assertEqual(module.SUITES['resources'][1:], ['-m', 'unittest', 'discover', '-s', 'tests/resources/tests', '-v'])


class Contracts(unittest.TestCase):
    def test_transition_budget_includes_child_start_and_teardown(self):
        r = harness()
        self.assertTrue(hasattr(r, 'transition_seconds'), 'transition accounting missing')
        self.assertEqual(r.transition_seconds({'start': 11., 'end': 21., 'drain_end': 23.}, 10., 24.), 4.)

    def test_cli_strict_opt_in_and_memory_units(self):
        r = harness()
        self.assertTrue(hasattr(r, 'parse_args'), 'public CLI missing')
        import contextlib
        import io
        args = ['--gold', 'gold.json', '--output', 'newdir', '--cpus', '2', '--memory', '4g', '--budget-seconds', '300']
        images = [value for e in r.ENGINES for value in ('--image', e + '=tag')]
        config = r.parse_args(args + images)
        self.assertEqual(config.memory, 4294967296)
        self.assertEqual(config.images, {e: 'tag' for e in r.ENGINES})
        for bad in (args, args + images + ['--cpus', 'nan'], args + images + ['--budget-seconds', '301'],
                    args + images + ['--image', 'rizzo=other'], args + images + ['--memory', '-1g']):
            with self.subTest(args=bad), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                r.parse_args(bad)
        offline = r.parse_args(['--rerender', 'receipt.json', '--output', 'newdir'])
        self.assertIsNotNone(offline.rerender)

    def test_external_sources_literal_payload_and_common_order(self):
        self.assertTrue((ROOT / 'tests/resources/run.py').exists(), 'resource runner missing')
        r = harness()
        gold = json.loads((ROOT / 'tests/evaluation/gold.json').read_text())
        gold['cases'][0]['source'] = 'aliasit'
        before = copy.deepcopy(gold)
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'gold.json'
            path.write_text(json.dumps(gold))
            cases = r.load_gold(path)
        self.assertEqual(gold, before)
        self.assertEqual([c['id'] for c in cases], [c['id'] for c in r.ordered_cases(gold['cases'])])
        self.assertEqual(r.payload(cases[0]), {'fields': [dict(fieldId=f['fieldId'], text=f['text'], allowedCategories=[]) for f in cases[0]['fields']]})
        self.assertEqual(r.evaluation.SOURCES, ['rizzo', 'gretel', 'targeted', 'legacy'])
        self.assertNotIn('text', json.dumps(r.case_metadata(cases)))
        bad = copy.deepcopy(gold)
        bad['cases'][0]['fields'][0]['text'] = 'word ' * 51
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'gold.json'
            path.write_text(json.dumps(bad))
            with self.assertRaises(ValueError):
                r.load_gold(path)


class Capacity(unittest.TestCase):
    def test_plateau_requires_comparable_mix_and_repeat(self):
        r = harness()
        self.assertTrue(hasattr(r, 'plateau'), 'capacity classification missing')
        def window(concurrency, rate, p95, mix, phase='load'):
            return dict(concurrency=concurrency, phase=phase, metrics=dict(throughput=rate, window_p95=p95,
                window_success=sum(mix.values()), case_mix=mix, error_rate=0, cancelled=0, pending=0))
        first = window(1, 10, .1, {'a': 50, 'b': 50})
        second = window(2, 10.5, .2, {'a': 50, 'b': 50})
        repeat = window(2, 10.2, .2, {'a': 50, 'b': 50}, 'confirmation')
        self.assertEqual(r.plateau([first, second, repeat])['status'], 'preliminary_plateau_observed')
        self.assertEqual(r.plateau([first, second, repeat])['concurrency'], 2)
        mixed = window(2, 10.2, .2, {'a': 100}, 'confirmation')
        self.assertEqual(r.plateau([first, second, mixed])['status'], 'inconclusive_different_mix')
        self.assertEqual(r.plateau([first, dict(second, metrics=dict(second['metrics'], case_mix={'b': 100}))])['status'], 'inconclusive_different_mix')
        self.assertEqual(r.plateau([first, second])['status'], 'inconclusive_unconfirmed')
        degraded = window(4, 8, .4, {'a': 50, 'b': 50})
        degraded['metrics']['error_rate'] = .01
        self.assertEqual(r.plateau([first, second, degraded])['candidate'], 2,
                         'later degradation must not change the first eligible confirmation level')
        self.assertEqual(r.plateau([first, window(2, 20, .1, {'a': 50, 'b': 50})])['status'], 'not_reached')
        second['metrics']['error_rate'] = .01
        self.assertEqual(r.plateau([first, second, repeat])['status'], 'observed_degradation')


class FakeHTTP(unittest.TestCase):
    def test_guard_accounts_for_buffered_started_and_finished_events(self):
        import http.server
        import threading
        import time
        r = harness()
        arrived = threading.Event()
        count = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                count.append(1)
                arrived.set()
                time.sleep(.3)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        def guard():
            if arrived.wait(.05):
                time.sleep(.03)  # Docker/telemetry guard can lag behind pipe events.
                return 'memory_guard'
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        try:
            stage = r.run_stage('127.0.0.1', server.server_port, cases, 4, .2,
                time.monotonic() + 3, socket_timeout=.5, drain_budget=.5, guard=guard)
            self.assertEqual(len(stage['observations']), len(count))
            self.assertGreater(len(count), 0)
            self.assertEqual(r.stage_metrics(stage, r.case_metadata(cases))['cancelled'], len(count))
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_budget_cancellation_and_interrupt_preserve_started_requests(self):
        import http.server
        import threading
        import time
        r = harness()
        entered = threading.Event()
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                entered.set()
                time.sleep(.4)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        def interrupt():
            if entered.is_set():
                raise KeyboardInterrupt
        try:
            stage = r.run_stage('127.0.0.1', server.server_port, cases, 1, .3,
                time.monotonic() + 3, socket_timeout=.5, drain_budget=.5, guard=interrupt)
            metrics = r.stage_metrics(stage, r.case_metadata(cases))
            self.assertEqual(metrics['started'], 1)
            self.assertEqual(metrics['cancelled'], 1)
            self.assertEqual(metrics['timeout'], 0)
            self.assertEqual(stage['stop_reason'], 'interrupted')
            self.assertFalse(stage['drained'])
        except KeyboardInterrupt:
            self.fail('interrupt discarded partial stage instead of preserving cancellation receipt')
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_errors_and_global_sequence_with_four_loopback_clients(self):
        import http.server
        import threading
        import time
        r = harness()
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            mode = 'http_error'
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                if self.mode == 'transport_error':
                    self.connection.shutdown(2)
                    self.connection.close()
                    return
                reply = b'{"secret":"DO NOT STORE"}' if self.mode == 'contract_error' else b'not json'
                code = 503 if self.mode == 'http_error' else 200
                if self.mode == 'success':
                    reply = json.dumps({'verdict': 'rejected', 'findings': [{'fieldId': body['fields'][0]['fieldId'], 'category': 'PERSON'}]}).encode()
                self.send_response(code)
                self.send_header('Content-Length', str(len(reply)))
                self.end_headers()
                self.wfile.write(reply)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        try:
            for mode in ('http_error', 'contract_error', 'transport_error', 'success'):
                with self.subTest(mode=mode):
                    Handler.mode = mode
                    stage = r.run_stage('127.0.0.1', server.server_port, cases, 4, .08,
                                        time.monotonic() + 3, socket_timeout=.3, drain_budget=.6)
                    metrics = r.stage_metrics(stage, r.case_metadata(cases))
                    self.assertGreater(metrics[mode], 0)
                    self.assertIn('error_p95', metrics, 'separate error latencies missing')
                    self.assertEqual([o['caseId'] for o in stage['observations']],
                                     [cases[i % len(cases)]['id'] for i in range(metrics['started'])])
                    self.assertLessEqual(stage['max_inflight'], 4)
                    self.assertNotIn('DO NOT STORE', json.dumps(stage))
                    self.assertEqual(metrics['started'], metrics['completed'] + metrics['cancelled'] + metrics['pending'])
        finally:
            server.shutdown()
            server.server_close()
            thread.join()

    def test_no_submission_when_full_socket_budget_unavailable(self):
        r = harness()
        self.assertTrue(hasattr(r, 'stage_admissible'), 'deadline admission missing')
        self.assertFalse(r.stage_admissible(10, 14.9, 5))
        self.assertTrue(r.stage_admissible(10, 15.1, 5))
        import time
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        stage = r.run_stage('127.0.0.1', 1, cases, 1, .01, time.monotonic() + .3,
                            socket_timeout=.5, drain_budget=.1)
        self.assertFalse(stage['drained'], 'an unstarted load is not a measured stage')
        self.assertEqual(stage['stop_reason'], 'stage_budget_exhausted')
        self.assertEqual(stage['observations'], [])
        short = r.run_stage('127.0.0.1', 1, cases, 1, .2, time.monotonic() + .25,
                            socket_timeout=.1, drain_budget=.5)
        self.assertEqual(short['stop_reason'], 'stage_budget_exhausted',
                         'do not disguise budget-forced idle as a complete load window')
        self.assertEqual(short['observations'], [])

    def test_timeout_stops_engine_and_sanitizes_errors(self):
        import http.server
        import threading
        import time
        r = harness()
        self.assertTrue(hasattr(r, 'stage_admissible'), 'deadline admission missing')
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                time.sleep(.3)  # Work remains queued after the client timeout.
                try:
                    self.send_response(200)
                    self.end_headers()
                    self.wfile.write(b'PRIVATE ERROR')
                except OSError:
                    pass
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        try:
            stage = r.run_stage('127.0.0.1', server.server_port, cases, 1, .5,
                                time.monotonic() + 3, socket_timeout=.08, drain_budget=.5)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertFalse(stage['drained'])
        self.assertEqual(stage['stop_reason'], 'server_drain_unknown')
        self.assertEqual(r.stage_metrics(stage, r.case_metadata(cases))['timeout'], 1)
        self.assertNotIn('PRIVATE', json.dumps(stage))

    def test_boundary_drains_without_artificial_timeout(self):
        r = harness()
        self.assertTrue(hasattr(r, 'run_stage'), 'closed-loop stage missing')
        import http.server
        import threading
        import time
        received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def do_POST(self):
                received.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                time.sleep(.12)
                body = b'{"verdict":"accepted","findings":[]}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        try:
            stage = r.run_stage('127.0.0.1', server.server_port, cases, 1, .05,
                                time.monotonic() + 5, socket_timeout=.5, drain_budget=.7)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        metrics = r.stage_metrics(stage, r.case_metadata(cases))
        self.assertEqual(metrics['started'], 1)
        self.assertEqual(metrics['success'], 1)
        self.assertEqual(metrics['window_success'], 0)
        self.assertEqual(metrics['drain_success'], 1)
        self.assertEqual(metrics['timeout'], 0)
        self.assertEqual(metrics['pending'], 0)
        self.assertTrue(stage['drained'])
        self.assertEqual(received, [r.payload(cases[0])])
        self.assertNotIn('findings', json.dumps(stage))


if __name__ == '__main__':
    unittest.main()
