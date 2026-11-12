import json
from pathlib import Path
import sys
import time
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


class FakeDocker:
    def __init__(self):
        self.calls = []
        self.objects = {}
        self.foreign = False
    def __call__(self, args, timeout):
        self.calls.append((args, timeout))
        if args[:1] == ['create']:
            name = args[args.index('--name') + 1]
            label = args[args.index('--label') + 1].split('=', 1)
            cid = format(len(self.objects) + 10, 'x') * 64
            self.objects[cid] = dict(Id=cid, Name='/' + name,
                Config={'Labels': dict([label])}, HostConfig={'NanoCpus': 2000000000, 'Memory': 4294967296, 'MemorySwap': 4294967296},
                State={'Running': False, 'OOMKilled': False, 'ExitCode': 0},
                NetworkSettings={'Ports': {'8000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '32100'}]}})
            return cid
        if args[:1] == ['inspect']:
            obj = self.objects.get(args[-1]) or next((o for o in self.objects.values() if o['Name'] == '/' + args[-1]), None)
            if not obj:
                raise RuntimeError('DOCKER_COMMAND_FAILED')
            if self.foreign:
                obj = dict(obj, Config={'Labels': {}})
            return json.dumps([obj])
        if args[:1] == ['rm']:
            self.objects.pop(args[-1])
            return args[-1]
        if args[:1] == ['ps']:
            return '\n'.join(self.objects)
        if args[:1] == ['start']:
            self.objects[args[-1]]['State']['Running'] = True
            return args[-1]
        raise AssertionError(args)


class LifecycleTests(unittest.TestCase):
    def test_interrupted_start_and_timed_out_create_cleanup_by_owner(self):
        import telemetry as t
        import run as r
        for error in (KeyboardInterrupt, TimeoutError):
            with self.subTest(error=error.__name__):
                fake = FakeDocker()
                once = False
                def command(args, timeout):
                    nonlocal once
                    if args[0] == ('start' if error is KeyboardInterrupt else 'create') and not once:
                        once = True
                        fake(args, timeout)  # Remote side effect happened before response was lost.
                        raise error()
                    return fake(args, timeout)
                class Docker(t.Docker):
                    def preflight(self, images, cpus, memory, deadline):
                        return {'images': {e: {'id': tag, 'cache_paths': []} for e, tag in images.items()}}
                    def static_inventory(self, cid, configured, deadline):
                        return {'paths': []}
                result = r.campaign(r.load_gold(r.ROOT / 'tests/evaluation/gold.json'),
                    {e: 'sha256:' + '1' * 64 for e in r.ENGINES}, 2, 4 * 1024**3, 30,
                    docker=Docker('fake', command=command))
                self.assertFalse(result['complete'])
                self.assertEqual(fake.objects, {})
                self.assertTrue(all(result['cleanup'].values()))

    def test_preflight_rejects_interference_and_records_native_images(self):
        import telemetry as t
        self.assertTrue(hasattr(t.Docker, 'preflight'), 'preflight missing')
        import platform
        arch = {'aarch64': 'arm64', 'x86_64': 'amd64'}.get(platform.machine(), platform.machine())
        calls = []
        interfering = False
        def command(args, timeout):
            calls.append(args)
            if args[0] == 'ps':
                return 'foreign-id' if interfering else ''
            if args[0] == 'info':
                return json.dumps(dict(NCPU=5, MemTotal=8 * 1024**3, CgroupVersion='2', Architecture=arch, ServerVersion='fixture'))
            if args[:2] == ['image', 'inspect']:
                return json.dumps([dict(Id='sha256:' + '1' * 64, Architecture=arch, Os='linux', Size=100,
                    Config={'Env': ['HF_HOME=/models/cache', 'SECRET=not-recorded'], 'Volumes': None,
                            'Entrypoint': ['node'], 'Cmd': ['server.mjs']})])
            raise AssertionError(args)
        docker = t.Docker('token', command=command)
        result = docker.preflight({e: 'tag' for e in ('rizzo', 'horizon', 'presidio')}, 2, 4 * 1024**3, time.monotonic() + 5)
        self.assertEqual(result['images']['rizzo']['cache_paths'], ['/models/cache'])
        self.assertNotIn('not-recorded', json.dumps(result))
        interfering = True
        with self.assertRaisesRegex(ValueError, 'INTERFERING'):
            docker.preflight({e: 'tag' for e in ('rizzo', 'horizon', 'presidio')}, 2, 4 * 1024**3, time.monotonic() + 5)
        self.assertFalse(any(a[0] in ('stop', 'rm') for a in calls))

    def test_static_tar_inventory_and_post_scan_gates(self):
        import io
        import tarfile
        import telemetry as t
        self.assertTrue(hasattr(t, 'scan_tar'), 'disk inventory missing')
        buffer = io.BytesIO()
        with tarfile.open(fileobj=buffer, mode='w') as tar:
            for path, size in [('app/models/model.bin', 13), ('root/.cache/a', 7),
                               ('home/node/.npm/a', 11), ('app/.venv/lib/python3.12/site-packages/it_core_news_sm/model', 17)]:
                member = tarfile.TarInfo(path)
                member.size = size
                tar.addfile(member, io.BytesIO(b'x' * size))
        buffer.seek(0)
        inventory = t.scan_tar(buffer, ['/custom/cache'])
        by_path = {x['path']: x for x in inventory}
        self.assertEqual(by_path['/app/models']['logical_bytes'], 13)
        self.assertEqual(by_path['/root/.cache']['logical_bytes'], 7)
        self.assertEqual(by_path['/custom/cache']['status'], 'absent')
        self.assertEqual(by_path['/app/.venv/lib/python3.12/site-packages/it_core_news_sm']['logical_bytes'], 17)
        fake = FakeDocker()
        docker = t.Docker('token', command=fake)
        with self.assertRaises(ValueError):
            docker.post_inventory('foreign', [], time.monotonic() + 2, collector_stopped=False)
        skipped = docker.post_inventory('foreign', [], time.monotonic() - 1, collector_stopped=True)
        self.assertIsNone(skipped['paths'])
        self.assertEqual(fake.calls, [])

    def test_equal_limits_loopback_ownership_and_verified_cleanup(self):
        import telemetry as t
        self.assertTrue(hasattr(t, 'Docker'), 'Docker lifecycle missing')
        fake = FakeDocker()
        docker = t.Docker('test-token', command=fake)
        cid = docker.create('rizzo', 'sha256:' + '1' * 64, 2, 4294967296, time.monotonic() + 10)
        args = fake.calls[0][0]
        self.assertIn('--pull=never', args)
        self.assertIn('127.0.0.1::8000', args)
        self.assertEqual(args[args.index('--memory-swap') + 1], '4294967296')
        self.assertEqual(docker.start(cid, 2, 4294967296, time.monotonic() + 5), 32100)
        fake.foreign = True
        self.assertFalse(docker.cleanup(time.monotonic() + 5)[cid])
        self.assertFalse(any(args[0] == 'rm' for args, _ in fake.calls))
        fake.foreign = False
        self.assertTrue(docker.cleanup(time.monotonic() + 5)[cid])
        self.assertEqual(fake.objects, {})
        self.assertTrue(all(0 < timeout <= 10 for _, timeout in fake.calls))


if __name__ == '__main__':
    unittest.main()
