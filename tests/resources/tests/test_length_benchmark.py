"""Deterministic A/B/C workload and bounded, one-at-a-time HTTP stage."""
import http.server
import json
from pathlib import Path
import sys
import threading
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class LengthWorkloadTests(unittest.TestCase):
    def test_ascii_lengths_and_same_fixed_sequence(self):
        import length_benchmark as benchmark
        for label, size in [('A', 10), ('B', 50), ('C', 150)]:
            with self.subTest(label=label):
                cases = benchmark.cases(label)
                self.assertEqual(len(cases), 3)
                self.assertTrue(all(len(c['text']) == size and c['text'].isascii() for c in cases))
                self.assertTrue(all(len(c['text'].split()) <= 50 for c in cases))
                self.assertEqual([c['id'] for c in benchmark.sequence(cases, 6)],
                                 [f'{label}-0', f'{label}-1', f'{label}-2'] * 2)

    def test_D_has_exactly_1000_ascii_characters_and_at_most_50_words(self):
        import length_benchmark as benchmark
        generated = benchmark.cases('D')
        self.assertEqual(benchmark.LENGTHS['D'], 1000)
        self.assertEqual([case['id'] for case in generated], ['D-0', 'D-1', 'D-2'])
        self.assertTrue(all(case['text'].isascii() and len(case['text']) == 1000
                            and len(case['text'].split()) <= 50 for case in generated))
        self.assertEqual([case['id'] for case in benchmark.sequence(generated, 6)],
                         ['D-0', 'D-1', 'D-2'] * 2)

    def test_cgroup_snapshot_checks_limits_and_cpu_counter(self):
        import length_benchmark as benchmark
        class FakeDocker:
            def call(self, args, deadline):
                self_args = args
                self.assertEqual(self_args[:3], ['exec', 'cid', 'sh'])
                return '@cpu\nusage_usec 123456\n@memory\n456\n@max\n4294967296\n@events\noom 0\noom_kill 0\n@quota\n100000 100000\n'
        fake = FakeDocker()
        fake.assertEqual = self.assertEqual
        snap = benchmark.snapshot(fake, 'cid', 1, 4294967296, 100)
        self.assertEqual(snap['usage_usec'], 123456)
        self.assertEqual(snap['memory_current'], 456)
        self.assertEqual(snap['oom_kill'], 0)
        with self.assertRaisesRegex(ValueError, 'CGROUP'):
            benchmark.snapshot(fake, 'cid', 1, 4000000000, 100)

    def test_cpu_average_uses_cgroup_read_bracket_instead_of_short_http_window(self):
        import length_benchmark as benchmark
        before = {'usage_usec': 1_000_000, 'sample_time': 10.0}
        after = {'usage_usec': 1_500_000, 'sample_time': 11.0}
        self.assertEqual(benchmark.cpu_average(before, after), 0.5)

    def test_invalid_count_is_rejected_before_container_side_effects(self):
        import length_benchmark as benchmark
        with self.assertRaises(SystemExit):
            benchmark.main(['--count', '7', '--output', '/unused'])

    def test_only_selected_band_runs_and_receipt_has_only_that_band(self):
        import length_benchmark as benchmark
        from unittest.mock import patch
        from tempfile import TemporaryDirectory
        import time

        seen = []
        class FakeDocker:
            def __init__(self, token):
                self.owned = {'cid': 'owned'}
                self.pending_names = set()
            def preflight(self, images, cpus, memory, deadline):
                return {'images': {'bardsai': {'id': 'sha256:' + '1' * 64}}}
            def create(self, *args, **kwargs):
                return 'cid'
            def start(self, *args):
                return 8000
            def verify(self, *args):
                return {'State': {'Running': True, 'OOMKilled': False, 'ExitCode': 0}}
            def cleanup(self, deadline):
                self.owned.clear()
                return {'cid': True}
        class FakeCollector:
            def __init__(self, cid, cpus):
                self.samples = [{'time': 0, 'memory_current': 1}]
                self.failure = None
            def poll(self):
                pass
            def stop(self, deadline):
                return True
        def batch(port, band_cases, *, count, timeout, guard):
            seen.append((band_cases[0]['id'][0], count))
            now = time.monotonic()
            return dict(completed=count, success=count, error_codes={}, stop_reason=None,
                        start_monotonic=now, end_monotonic=now + .01,
                        observations=[], cpu_cores_average=1)
        def snapshot(*args):
            return dict(usage_usec=100, sample_time=time.monotonic(),
                        memory_current=100, oom=0, oom_kill=0)
        with TemporaryDirectory() as directory:
            with patch('telemetry.Docker', FakeDocker), patch('telemetry.Collector', FakeCollector), \
                 patch.object(benchmark.run, 'wait_ready', return_value=None), \
                 patch.object(benchmark, 'request_batch', side_effect=batch), \
                 patch.object(benchmark, 'snapshot', side_effect=snapshot), \
                 patch.object(benchmark, 'cpu_average', return_value=1):
                receipt = benchmark.measure_engine('bardsai', 'image', 6, Path(directory), bands=('B',))
            saved = json.loads((Path(directory) / 'results.json').read_text())
        self.assertEqual(seen, [('B', 3), ('B', 6)])
        self.assertEqual(list(saved['stages']), ['B'])
        self.assertTrue(receipt['complete'])
        self.assertTrue(receipt['cleanup'])

    def test_cli_passes_only_band_B_to_selected_engine(self):
        import length_benchmark as benchmark
        from unittest.mock import patch
        from tempfile import TemporaryDirectory
        with TemporaryDirectory() as directory:
            output = Path(directory) / 'new-run'
            with patch.object(benchmark, 'measure_engine', return_value={
                    'complete': True, 'cleanup': True, 'stop_reason': None}) as measure:
                result = benchmark.main(['--engine', 'bardsai', '--band', 'B',
                                         '--count', '60', '--output', str(output)])
            summary = json.loads((output / 'summary.json').read_text())
        self.assertEqual(result, 0)
        self.assertEqual(list(summary), ['bardsai'])
        self.assertEqual(measure.call_args.kwargs, {'bands': ('B',)})

    def test_collector_failure_still_cleans_owned_container_and_saves_partial(self):
        import length_benchmark as benchmark
        from unittest.mock import patch
        from tempfile import TemporaryDirectory
        from pathlib import Path
        class FakeDocker:
            cleaned = False
            def __init__(self, token):
                self.owned = {'cid': 'owned'}
                self.pending_names = set()
            def preflight(self, images, cpus, memory, deadline):
                return {'images': {'presidio': {'id': 'sha256:' + '1' * 64}}}
            def create(self, *args, **kwargs):
                return 'cid'
            def start(self, *args):
                return 8000
            def verify(self, *args):
                return {'State': {'Running': True, 'OOMKilled': False, 'ExitCode': 0}}
            def cleanup(self, deadline):
                FakeDocker.cleaned = True
                self.owned.clear()
                return {'cid': True}
        class BadCollector:
            def __init__(self, cid, cpus):
                self.samples = []
            def poll(self):
                raise OSError('probe failed')
            def stop(self, deadline):
                raise OSError('shutdown failed')
        with TemporaryDirectory() as directory:
            with patch('telemetry.Docker', FakeDocker), patch('telemetry.Collector', BadCollector), \
                 patch.object(benchmark.run, 'wait_ready', return_value='readiness_timeout'):
                receipt = benchmark.measure_engine('presidio', 'image', 6, Path(directory))
            saved = json.loads((Path(directory) / 'results.json').read_text())
        self.assertTrue(FakeDocker.cleaned)
        self.assertTrue(receipt['cleanup'])
        self.assertFalse(saved['complete'])
        self.assertIn('collector_shutdown_failed', saved['incidents'])

    def test_fixed_request_count_serial_real_http_and_sanitized_receipt(self):
        import length_benchmark as benchmark
        calls = []
        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self):
                data = self.rfile.read(int(self.headers['Content-Length']))
                fields = json.loads(data)['fields']
                calls.append(fields[0]['text'])
                reply = json.dumps({'verdict': 'accepted', 'findings': []}).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(reply)))
                self.end_headers()
                self.wfile.write(reply)
            def log_message(self, *_):
                pass
        with http.server.HTTPServer(('127.0.0.1', 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                cases = benchmark.cases('A')
                receipt = benchmark.request_batch(server.server_port, cases, count=6, timeout=2,
                                                  guard=lambda: None)
            finally:
                server.shutdown()
                thread.join()
        self.assertEqual(calls, [c['text'] for c in benchmark.sequence(cases, 6)])
        self.assertEqual(receipt['success'], 6)
        self.assertEqual(receipt['max_inflight'], 1)
        self.assertEqual(receipt['completed'], 6)
        self.assertNotIn('dato', json.dumps(receipt))


if __name__ == '__main__':
    unittest.main()
