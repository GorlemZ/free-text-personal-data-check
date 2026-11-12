from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

FRAME = '''BEGIN 10.00
@memory.current
100
@memory.max
1000
@memory.peak
150
@memory.stat
anon 60
file 30
shmem 10
kernel 10
@memory.events
oom 0
oom_kill 0
@memory.swap.current
0
@cpu.stat
usage_usec 1000000
nr_throttled 2
throttled_usec 100
@cpu.max
200000 100000
@proc:1
Name:\tnode
Pid:\t1
PPid:\t0
VmRSS:\t20 kB
@proc:8
Name:\tnode
Pid:\t8
PPid:\t1
VmRSS:\t30 kB
END 10.02
'''


class TelemetryTests(unittest.TestCase):
    def test_shell_inventory_execution_and_hung_collector_are_bounded(self):
        import subprocess
        import tempfile
        import time
        import telemetry as t
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'cache with spaces'
            path.mkdir()
            (path / 'data').write_bytes(b'x' * 200)
            result = subprocess.run(['sh', '-c', t.DISK_SCRIPT, 'scan', str(path), str(path / 'missing')],
                                    capture_output=True, timeout=2, text=True)
            self.assertEqual(result.returncode, 0)
            self.assertIn(str(path) + '\tpresent\t', result.stdout)
            self.assertIn(str(path / 'missing') + '\tabsent\t-', result.stdout)
        def launch(args, **kwargs):
            return subprocess.Popen([sys.executable, '-c', 'import time; time.sleep(10)'], **kwargs)
        collector = t.Collector('fake', 2, launch=launch)
        started = time.monotonic()
        self.assertFalse(collector.stop(time.monotonic() + .05))
        self.assertLess(time.monotonic() - started, 1)
        self.assertIsNotNone(collector.process.poll())
        syntax = subprocess.run(['sh', '-n'], input=t.COLLECTOR_SCRIPT, text=True, capture_output=True, timeout=2)
        self.assertEqual(syntax.returncode, 0, syntax.stderr)

    def test_persistent_collector_and_safety_guards(self):
        import time
        import subprocess
        import telemetry as t
        self.assertTrue(hasattr(t, 'Collector'), 'persistent collector missing')
        commands = []
        def launch(args, **kwargs):
            commands.append(args)
            return subprocess.Popen([sys.executable, '-u', '-c',
                'import sys\nfor line in sys.stdin:\n if line.strip() != "sample": break\n print(' + repr(FRAME) + ', flush=True)'], **kwargs)
        collector = t.Collector('owned-id', 2, launch=launch)
        try:
            until = time.monotonic() + 2
            while not collector.samples and time.monotonic() < until:
                collector.poll()
                time.sleep(.01)
            self.assertEqual(len(collector.samples), 1)
            self.assertIsNone(collector.guard())
            self.assertEqual(commands[0][:4], ['docker', 'exec', '-i', 'owned-id'])
            self.assertNotIn('du ', t.COLLECTOR_SCRIPT)
            self.assertEqual(t.safety_reason(dict(collector.samples[0], memory_current=900)), 'memory_guard')
            self.assertEqual(t.safety_reason(dict(collector.samples[0], oom_kill=1)), 'oom_guard')
            self.assertEqual(t.safety_reason(dict(collector.samples[0], memory_current=None)), 'telemetry_required_missing')
            collector.last_received = time.monotonic() - 4
            self.assertEqual(collector.guard(), 'telemetry_lost')
        finally:
            self.assertTrue(collector.stop(time.monotonic() + 1))
        self.assertIsNotNone(collector.process.poll())

    def test_cpu_uses_counter_acquisition_interval_not_frame_start(self):
        import telemetry as t
        first_text = FRAME.replace('@cpu.stat', 'CPU_BEGIN 10.00\n@cpu.stat').replace('@cpu.max', 'CPU_END 10.02\n@cpu.max')
        second_text = FRAME.replace('BEGIN 10.00', 'BEGIN 11.00').replace('END 10.02', 'END 11.42').replace('usage_usec 1000000', 'usage_usec 3800000')
        second_text = second_text.replace('@cpu.stat', 'CPU_BEGIN 11.40\n@cpu.stat').replace('@cpu.max', 'CPU_END 11.42\n@cpu.max')
        first = t.parse_frame(first_text, 20., 2)
        second = t.parse_frame(second_text, 21.5, 2, first)
        self.assertAlmostEqual(second['cpu_cores'], 2.)
        self.assertEqual(second['cpu_time_source'], 'cpu_stat_midpoint')
        self.assertAlmostEqual(second['cpu_read_seconds'], .02)
        self.assertIn('CPU_BEGIN', t.COLLECTOR_SCRIPT)
        self.assertIn('CPU_END', t.COLLECTOR_SCRIPT)

    def test_frame_cpu_overlap_missing_and_reset(self):
        self.assertTrue((Path(__file__).resolve().parents[1] / 'telemetry.py').exists(), 'collector missing')
        import telemetry as t
        first = t.parse_frame(FRAME, 20, 2)
        self.assertEqual(first['memory_current'], 100)
        self.assertEqual(first['file'], 30)
        self.assertEqual(first['shmem'], 10)
        self.assertEqual(first['processes'][1]['rss'], 30 * 1024)
        self.assertAlmostEqual(first['read_seconds'], .02)
        self.assertIsNone(first['cpu_cores'])
        second = t.parse_frame(FRAME.replace('10.00', '11.00').replace('10.02', '11.02').replace('usage_usec 1000000', 'usage_usec 2500000'), 21, 2, first)
        self.assertEqual(second['cpu_cores'], 1.5)
        self.assertEqual(second['cpu_budget_percent'], 75)
        self.assertEqual(second['gap_seconds'], 1)
        reset = t.parse_frame(FRAME, 22, 2, second)
        self.assertIsNone(reset['cpu_cores'])
        self.assertIn('cpu_delta', reset['missing'])
        missing = t.parse_frame('BEGIN 1\nEND 1.01\n', 1, 2)
        self.assertIsNone(missing['memory_current'])
        self.assertIn('memory_current', missing['missing'])


if __name__ == '__main__':
    unittest.main()
