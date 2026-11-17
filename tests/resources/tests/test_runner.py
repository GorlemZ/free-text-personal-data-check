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
    def test_fixed_rate_schedule_uses_absolute_monotonic_deadlines(self):
        r = harness()
        self.assertEqual(
            r.fixed_rate_schedule(start=10.0, submission_end=10.75, rate=4.0),
            [(0, 10.0), (1, 10.25), (2, 10.5)],
        )
        self.assertEqual(
            r.fixed_rate_schedule(start=10.0, submission_end=10.5000001, rate=2.0),
            [(0, 10.0), (1, 10.5)],
        )
        for rate in (0, -1, float('inf'), float('nan')):
            with self.subTest(rate=rate), self.assertRaises(ValueError):
                r.fixed_rate_schedule(start=10.0, submission_end=11.0, rate=rate)
        with self.assertRaisesRegex(ValueError, 'ARRIVALS'):
            r.fixed_rate_schedule(start=0., submission_end=1., rate=100001.)

    def test_fixed_rate_non_admission_reasons_are_distinct(self):
        r = harness()
        classify = r.fixed_rate_non_admission
        self.assertEqual(classify(now=9., submission_end=10., drain_deadline=12.,
                                  timeout=1., active=0, max_inflight=1, stopped=True),
                         'stopped_before_submit')
        self.assertEqual(classify(now=10., submission_end=10., drain_deadline=12.,
                                  timeout=1., active=0, max_inflight=1, stopped=False),
                         'late_arrival')
        self.assertEqual(classify(now=9.5, submission_end=10., drain_deadline=10.4,
                                  timeout=1., active=0, max_inflight=1, stopped=False),
                         'insufficient_drain')
        self.assertEqual(classify(now=9., submission_end=10., drain_deadline=12.,
                                  timeout=1., active=1, max_inflight=1, stopped=False),
                         'client_capacity_exhausted')
        self.assertIsNone(classify(now=9., submission_end=10., drain_deadline=12.,
                                   timeout=1., active=0, max_inflight=1, stopped=False))

    def test_fixed_rate_requires_worker_start_slack_after_socket_timeout(self):
        r = harness()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        import time
        with self.assertRaisesRegex(ValueError, 'DRAIN'):
            r.run_fixed_rate_stage(
                '127.0.0.1', 1, cases, rate=1., duration=.1,
                deadline=time.monotonic() + 2., socket_timeout=.5, drain_budget=.5,
                max_client_inflight=1,
            )

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

    def test_open_loop_cli_is_single_engine_decimal_limit_opt_in(self):
        r = harness()
        import contextlib
        import io
        base = ['open-loop', '--engine', 'horizon', '--candidate', 'A', '--image', 'sha256:' + '1' * 64,
                '--gold', 'gold.json', '--rate', '6', '--measurement-seconds', '5',
                '--drain-seconds', '2', '--socket-timeout-seconds', '1', '--max-client-inflight', '32',
                '--cpus', '2', '--memory', '4000000000', '--budget-seconds', '35', '--output', 'newdir']
        config = r.parse_args(base)
        self.assertEqual(config.mode, 'open-loop')
        self.assertEqual(config.engine, 'horizon')
        self.assertEqual(config.candidate, 'A')
        self.assertEqual(config.memory, 4_000_000_000)
        self.assertEqual(config.rate, 6.)
        protocol = list(base)
        protocol[protocol.index('--measurement-seconds') + 1] = '90'
        protocol[protocol.index('--drain-seconds') + 1] = '6'
        protocol[protocol.index('--socket-timeout-seconds') + 1] = '5'
        protocol[protocol.index('--budget-seconds') + 1] = '157'
        protocol[protocol.index('--rate') + 1] = '1'
        protocol[1:1] = ['--stabilization-seconds', '30']
        self.assertEqual(r.parse_args(protocol).stabilization_seconds, 30.)
        too_short = list(protocol)
        too_short[too_short.index('--budget-seconds') + 1] = '156'
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            r.parse_args(too_short)
        for replacement in (
                ['--candidate', 'B'], ['--engine', 'presidio'], ['--memory', '4g'],
                ['--cpus', '1'], ['--drain-seconds', '1']):
            bad = list(base)
            key, value = replacement
            bad[bad.index(key) + 1] = value
            with self.subTest(replacement=replacement), contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
                r.parse_args(bad)

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
        self.assertEqual(r.evaluation.SOURCES, ['rizzo', 'gretel', 'targeted', 'legacy', 'aliasit'])
        self.assertNotIn('text', json.dumps(r.case_metadata(cases)))
        bad = copy.deepcopy(gold)
        bad['cases'][0]['fields'][0]['text'] = 'word ' * 51
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'gold.json'
            path.write_text(json.dumps(bad))
            with self.assertRaises(ValueError):
                r.load_gold(path)


class Capacity(unittest.TestCase):
    def test_fixed_rate_completion_cohorts_include_errors(self):
        r = harness()
        stage = dict(
            start=1., submissionEnd=2., observations=[
                dict(index=0, caseId='a', scheduledAt=1., offeredAt=1., submittedAt=1.,
                     finish=1.5, status='success', code=None),
                dict(index=1, caseId='a', scheduledAt=1.5, offeredAt=1.5, submittedAt=1.5,
                     finish=2.2, status='http_error', code='HTTP_503'),
            ],
        )
        metrics = r.fixed_rate_metrics(stage, [dict(id='a', fields=2)])
        self.assertEqual(metrics['completed'], 2)
        self.assertEqual(metrics['in_window_completed'], 1)
        self.assertEqual(metrics['drain_completed'], 1)
        self.assertEqual(metrics['success'], 1)
        self.assertEqual(metrics['http_error'], 1)

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
    def test_fixed_rate_receipt_excludes_request_and_response_sentinels(self):
        import http.server
        import threading
        import time
        r = harness()
        request_sentinel = 'REQUEST_SENTINEL_9C6DB7'
        response_sentinel = 'RESPONSE_SENTINEL_77A9E1'
        seen_request = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                body = self.rfile.read(int(self.headers['Content-Length']))
                seen_request.append(request_sentinel.encode() in body)
                response = ('{"debug":"' + response_sentinel + '"}').encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(response)))
                self.end_headers()
                self.wfile.write(response)

            def log_message(self, format, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        source = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        case = dict(source[0])
        case['fields'] = [dict(field) for field in source[0]['fields']]
        case['fields'][0]['text'] = request_sentinel
        cases = [case]
        try:
            stage = r.run_fixed_rate_stage(
                '127.0.0.1', server.server_port, cases, rate=1., duration=.1,
                deadline=time.monotonic() + 3., socket_timeout=.5, drain_budget=.7,
                max_client_inflight=1,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        serialized = json.dumps(stage)
        self.assertEqual(seen_request, [True])
        self.assertEqual(stage['observations'][0]['status'], 'contract_error')
        self.assertNotIn(request_sentinel, serialized)
        self.assertNotIn(response_sentinel, serialized)

    def test_fixed_rate_client_capacity_exhaustion_is_explicit(self):
        import http.server
        import threading
        import time
        r = harness()
        received = []

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                received.append(time.monotonic())
                time.sleep(.5)
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
            stage = r.run_fixed_rate_stage(
                '127.0.0.1', server.server_port, cases, rate=10., duration=.3,
                deadline=time.monotonic() + 4., socket_timeout=1.2, drain_budget=1.4,
                max_client_inflight=1,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        metrics = r.fixed_rate_metrics(stage, r.case_metadata(cases))
        self.assertEqual(metrics['offered'], 3)
        self.assertEqual(metrics['submitted'], 1)
        self.assertEqual(metrics['client_capacity_exhausted'], 2)
        self.assertEqual(metrics['success'], 1)
        self.assertEqual(stage['maxInflight'], 1)
        self.assertEqual(len(received), 1)

    def test_fixed_rate_boundary_preserves_full_socket_timeout(self):
        import http.server
        import threading
        import time
        r = harness()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                time.sleep(.65)
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
            stage = r.run_fixed_rate_stage(
                '127.0.0.1', server.server_port, cases, rate=2., duration=.7,
                deadline=time.monotonic() + 4., socket_timeout=.8, drain_budget=1.,
                max_client_inflight=4,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        metrics = r.fixed_rate_metrics(stage, r.case_metadata(cases))
        self.assertTrue(stage['drained'], stage)
        self.assertEqual(metrics['submitted'], 2, stage)
        self.assertEqual(metrics['success'], 2)
        self.assertEqual(metrics['timeout'], 0)
        self.assertGreaterEqual(metrics['drain_completed'], 1)

    def test_fixed_rate_guard_reconciles_buffered_submit_events(self):
        import http.server
        import multiprocessing
        import threading
        import time
        r = harness()
        children_before = {child.pid for child in multiprocessing.active_children()}
        received = []
        tenth_arrived = threading.Event()
        lock = threading.Lock()

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                with lock:
                    received.append(time.monotonic())
                    if len(received) >= 10:
                        tenth_arrived.set()
                time.sleep(.2)
                try:
                    body = b'{"verdict":"accepted","findings":[]}'
                    self.send_response(200)
                    self.send_header('Content-Length', str(len(body)))
                    self.end_headers()
                    self.wfile.write(body)
                except (BrokenPipeError, ConnectionResetError):
                    pass

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')

        guard_calls = 0

        def guard():
            nonlocal guard_calls
            guard_calls += 1
            if guard_calls == 1:
                tenth_arrived.wait(1.)
            return 'memory_guard' if tenth_arrived.is_set() else None

        try:
            stage = r.run_fixed_rate_stage(
                '127.0.0.1', server.server_port, cases, rate=200., duration=.2,
                deadline=time.monotonic() + 4., socket_timeout=1., drain_budget=1.2,
                max_client_inflight=32, guard=guard,
            )
            time.sleep(.1)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        metrics = r.fixed_rate_metrics(stage, r.case_metadata(cases))
        self.assertEqual(stage['stop_reason'], 'memory_guard')
        self.assertIsNotNone(stage.get('stopAcknowledgedAt'), stage)
        self.assertTrue(all(item['offeredAt'] <= stage['stopAcknowledgedAt']
                            for item in stage['observations']), stage)
        self.assertGreaterEqual(metrics['submitted'], len(received), stage)
        not_admitted = sum(int(metrics[name] or 0) for name in (
            'client_capacity_exhausted', 'late_arrival', 'insufficient_drain',
            'stopped_before_submit', 'accounting_unknown'))
        self.assertEqual(metrics['offered'],
                         metrics['submitted'] + not_admitted, stage)
        indices = [item['index'] for item in stage['observations']]
        self.assertEqual(len(indices), len(set(indices)))
        self.assertTrue(stage['accountingComplete'], stage)
        children_after = {child.pid for child in multiprocessing.active_children()}
        self.assertLessEqual(children_after, children_before)

    def test_fixed_rate_arrivals_do_not_wait_for_prior_responses(self):
        import http.server
        import threading
        import time
        r = harness()
        starts = []
        finishes = []
        lock = threading.Lock()
        third_arrived = threading.Event()

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'

            def do_POST(self):
                self.rfile.read(int(self.headers['Content-Length']))
                with lock:
                    starts.append(time.monotonic())
                    if len(starts) == 3:
                        third_arrived.set()
                third_arrived.wait(1.2)
                body = b'{"verdict":"accepted","findings":[]}'
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
                with lock:
                    finishes.append(time.monotonic())

            def log_message(self, *args):
                pass

        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        cases = r.load_gold(ROOT / 'tests/evaluation/gold.json')
        try:
            stage = r.run_fixed_rate_stage(
                '127.0.0.1', server.server_port, cases, rate=5., duration=.6,
                deadline=time.monotonic() + 4., socket_timeout=1.5, drain_budget=1.7,
                max_client_inflight=8,
            )
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        metrics = r.fixed_rate_metrics(stage, r.case_metadata(cases))
        self.assertEqual(metrics['offered'], 3)
        self.assertEqual(metrics['submitted'], 3, stage)
        self.assertEqual(metrics['success'], 3)
        self.assertTrue(stage['drained'])
        self.assertEqual(len(starts), 3)
        self.assertLess(starts[2], finishes[0], 'later arrivals waited for an earlier response')
        self.assertTrue(all(item['scheduledAt'] is not None for item in stage['observations']))
        scheduled = [float(item['scheduledAt']) for item in stage['observations']]
        self.assertAlmostEqual(scheduled[1] - scheduled[0], .2, places=6)
        self.assertAlmostEqual(scheduled[2] - scheduled[1], .2, places=6)
        self.assertTrue(all(float(item['offeredAt']) >= float(item['scheduledAt'])
                            for item in stage['observations']), stage)
        self.assertNotIn('text', json.dumps(stage))
        self.assertNotIn('findings', json.dumps(stage))

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
