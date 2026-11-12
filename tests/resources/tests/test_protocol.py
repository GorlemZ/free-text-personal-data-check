import http.server
import json
from pathlib import Path
import sys
import threading
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from test_lifecycle import FakeDocker
from test_telemetry import FRAME


class ProtocolTests(unittest.TestCase):
    def test_unmeasured_load_is_null_but_measured_zero_is_zero(self):
        import run as r
        import tempfile
        stage: dict = dict(phase='load', concurrency=1, start=1., end=1., drain_end=1.,
                     max_inflight=0, drained=False, stop_reason='stage_budget_exhausted', observations=[])
        cases = [dict(id='case-a', source='aliasit', fields=1, characters=1, words=1)]
        self.assertIsNone(r.stage_metrics(stage, cases)['throughput'])
        receipt = dict(schemaVersion=1, config={'cpus': 2, 'memory': 4294967296, 'budget_seconds': 300},
            cases=cases, order=['case-a'], engines={'rizzo': dict(
                image={'id': 'sha256:test', 'logical_bytes': 100}, static_disk={'paths': []},
                post_disk={'paths': None, 'reason': 'budget_exhausted'}, stop_reason='stage_budget_exhausted',
                cleanup=True, samples=[], coverage={'complete': False}, stages=[stage])},
            complete=False, elapsed=1., incidents=[], cleanup={}, stop_reason='partial')
        with tempfile.TemporaryDirectory() as tmp:
            target = Path(tmp) / 'unmeasured'
            r.render(receipt, target)
            self.assertIn('| rizzo | null |', (target / 'report.md').read_text())
            stage.update(end=2., drain_end=2., stop_reason=None, drained=True)
            self.assertEqual(r.stage_metrics(stage, cases)['throughput'], 0.)
            target = Path(tmp) / 'measured'
            r.render(receipt, target)
            self.assertIn('| rizzo | 0 |', (target / 'report.md').read_text())

    def test_failed_collector_shutdown_marks_partial_and_skips_disk(self):
        import run as r
        import telemetry as t
        from unittest.mock import patch
        fake = FakeDocker()
        class Docker(t.Docker):
            def preflight(self, images, cpus, memory, deadline):
                return {'images': {e: {'id': tag, 'cache_paths': []} for e, tag in images.items()}}
            def static_inventory(self, cid, configured, deadline):
                return {'paths': []}
            def post_inventory(self, *args, **kwargs):
                raise AssertionError('disk scan after failed collector shutdown')
        class Collector:
            def __init__(self, *args):
                self.samples = []
            def guard(self):
                return None
            def poll(self):
                pass
            def stop(self, deadline):
                return False
        def stage(*args, **kwargs):
            now = time.monotonic()
            return dict(concurrency=args[3], start=now, end=now, drain_end=now,
                        observations=[], max_inflight=0, drained=True, stop_reason=None)
        with patch.object(r, 'wait_ready', return_value=None), patch.object(r, 'run_stage', side_effect=stage):
            receipt = r.campaign(r.load_gold(r.ROOT / 'tests/evaluation/gold.json'),
                {e: 'sha256:' + '1' * 64 for e in r.ENGINES}, 2, 4 * 1024**3, 30,
                docker=Docker('fake', command=fake), collector_factory=Collector,
                protocol=r.Protocol(idle=0, recovery=0, reserve=1))
        self.assertFalse(receipt['complete'], 'failed collector termination is not a complete protocol')
        self.assertTrue(all(e['stop_reason'] == 'collector_shutdown_failed' for e in receipt['engines'].values()))
        self.assertEqual(fake.objects, {})

    def test_safety_stop_cleanup_failure_never_starts_next_engine(self):
        import run as r
        import telemetry as t
        fake = FakeDocker()
        starts = []
        def command(args, timeout):
            if args[0] == 'start':
                starts.append(args[-1])
            if args[0] == 'rm':
                raise RuntimeError('DOCKER_COMMAND_FAILED')
            return fake(args, timeout)
        class Docker(t.Docker):
            def preflight(self, images, cpus, memory, deadline):
                return {'host': {}, 'images': {e: {'id': tag, 'cache_paths': [], 'logical_bytes': 1} for e, tag in images.items()}}
            def static_inventory(self, cid, configured, deadline):
                return {'paths': []}
        class Collector:
            def __init__(self, *args):
                self.samples = []
            def guard(self):
                return 'memory_guard'
            def poll(self):
                pass
            def stop(self, deadline):
                return True
        receipt = r.campaign(r.load_gold(r.ROOT / 'tests/evaluation/gold.json'),
            {e: 'sha256:' + '1' * 64 for e in r.ENGINES}, 2, 4 * 1024**3, 10,
            docker=Docker('fake', command=command), collector_factory=Collector,
            protocol=r.Protocol(reserve=1, socket_timeout=.1))
        self.assertEqual(len(starts), 1, 'never overlap engines after unverified cleanup')
        self.assertFalse(receipt['complete'])
        self.assertEqual(receipt['stop_reason'], 'cleanup_failed_no_next_engine')

    def test_report_offline_rerender_is_deterministic_and_validated(self):
        import run as r
        import tempfile
        self.assertTrue(hasattr(r, 'render'), 'offline report missing')
        receipt = dict(schemaVersion=1, config={'cpus': 2, 'memory': 4294967296, 'budget_seconds': 300},
            cases=[dict(id='case-a', source='aliasit', fields=2, characters=15, words=4)], order=['case-a'],
            engines={'rizzo': dict(image={'id': 'sha256:test', 'logical_bytes': 100},
                static_disk={'paths': []}, post_disk={'paths': None, 'reason': 'budget_exhausted'},
                stop_reason=None, cleanup=True, samples=[], coverage={'complete': False}, stages=[dict(
                    phase='load', concurrency=1, start=1., end=2., drain_end=2.1, max_inflight=1,
                    drained=True, stop_reason=None, observations=[dict(index=0, caseId='case-a', start=1.1,
                    finish=1.5, status='success', code=None), dict(index=1, caseId='case-a', start=1.6,
                    finish=2.1, status='http_error', code='HTTP_503')])])},
            complete=False, elapsed=3., incidents=[], cleanup={}, stop_reason='partial')
        with tempfile.TemporaryDirectory() as tmp:
            a, b = Path(tmp) / 'a', Path(tmp) / 'b'
            r.render(receipt, a)
            raw = json.loads((a / 'results.json').read_text())
            r.render(raw, b)
            for filename in ('results.json', 'stages.csv', 'samples.csv', 'report.md'):
                self.assertEqual((a / filename).read_bytes(), (b / filename).read_bytes())
            self.assertIn('aliasit', (a / 'stages.csv').read_text())
            self.assertIn('sampled', (a / 'report.md').read_text())
            with self.assertRaises(FileExistsError):
                r.render(raw, a)
            raw['engines']['rizzo']['stages'][0]['observations'][0]['finish'] = .5
            with self.assertRaises(ValueError):
                r.render(raw, Path(tmp) / 'bad')

    def test_full_protocol_sequential_fake_http_and_cleanup(self):
        import run as r
        import telemetry as t
        self.assertTrue(hasattr(r, 'campaign'), 'campaign missing')
        requests = []
        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = 'HTTP/1.1'
            def reply(self, body):
                body = json.dumps(body).encode()
                self.send_response(200)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
            def do_GET(self):
                self.reply({'status': 'ready'})
            def do_POST(self):
                requests.append(json.loads(self.rfile.read(int(self.headers['Content-Length']))))
                self.reply({'verdict': 'accepted', 'findings': []})
            def log_message(self, *args):
                pass
        server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        server.daemon_threads = True
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        fake = FakeDocker()
        order = []
        class Docker(t.Docker):
            def preflight(self, images, cpus, memory, deadline):
                return {'host': {}, 'images': {e: {'id': tag, 'cache_paths': [], 'logical_bytes': 1} for e, tag in images.items()}}
            def static_inventory(self, cid, paths, deadline):
                order.append('static')
                return {'paths': []}
            def start(self, cid, cpus, memory, deadline):
                order.append('start')
                super().start(cid, cpus, memory, deadline)
                return server.server_port
            def post_inventory(self, cid, paths, deadline, *, collector_stopped):
                self_test.assertTrue(collector_stopped)
                order.append('post')
                return {'paths': []}
        class Collector:
            def __init__(self, cid, cpus):
                self.samples = [t.parse_frame(FRAME.replace('1000\n', '4294967296\n'), time.monotonic(), cpus)]
            def guard(self):
                return None
            def poll(self):
                pass
            def stop(self, deadline):
                order.append('collector_stop')
                return True
        self_test = self
        cases = r.load_gold(r.ROOT / 'tests/evaluation/gold.json')
        protocol = r.Protocol(engine_seconds=4, readiness=.5, idle=.01, warmup=.03, window=.03,
                              recovery=.01, drain=1.5, reserve=1, socket_timeout=.15, engine_cleanup=.1)
        try:
            receipt = r.campaign(cases, {e: 'sha256:' + '1' * 64 for e in r.ENGINES}, 2, 4 * 1024**3, 15,
                                 docker=Docker('fake', command=fake), collector_factory=Collector, protocol=protocol)
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(order[:3], ['static'] * 3)
        self.assertEqual(order[3:], ['start', 'collector_stop', 'post'] * 3)
        self.assertEqual(set(receipt['engines']), set(r.ENGINES))
        self.assertTrue(receipt['complete'], receipt)
        for engine in receipt['engines'].values():
            self.assertEqual([s['concurrency'] for s in engine['stages'] if s['phase'] == 'load'], [1, 2, 4, 8])
            self.assertTrue(engine['cleanup'])
        self.assertEqual(fake.objects, {})
        self.assertTrue(requests)
        self.assertNotIn('text', json.dumps(receipt))
        self.assertLess(receipt['elapsed'], 15)
        r.validate_receipt(receipt)
        import tempfile
        import subprocess
        with tempfile.TemporaryDirectory() as tmp:
            first, second = Path(tmp) / 'first', Path(tmp) / 'second'
            r.render(receipt, first)
            result = subprocess.run([sys.executable, str(r.ROOT / 'tests/resources/run.py'), '--rerender',
                str(first / 'results.json'), '--output', str(second)], capture_output=True, timeout=5)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual((first / 'report.md').read_bytes(), (second / 'report.md').read_bytes())


if __name__ == '__main__':
    unittest.main()
