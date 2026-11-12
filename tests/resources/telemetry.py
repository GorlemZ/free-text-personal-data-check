"""Read-only cgroup v2/proc collector and bounded Docker transport."""
import re
import os
import subprocess
import time
import json
import sys
import tarfile
from pathlib import Path, PurePosixPath

DEFAULT_PATHS = ['/app/models', '/root/.cache', '/root/.npm', '/root/.local/share/uv',
                 '/home/node/.cache', '/home/node/.npm', '/home/analyzer/.cache',
                 '/home/analyzer/.local/share/uv', '/app/node_modules/.cache', '/tmp/.cache']


def scan_tar(stream, configured):
    """No extraction or model copies: tar headers plus streaming discarded bytes."""
    paths = {p: dict(path=p, status='absent', logical_bytes=None, allocated_bytes=None,
                    reason='export_has_logical_sizes_only') for p in DEFAULT_PATHS + configured}
    with tarfile.open(fileobj=stream, mode='r|*') as archive:
        for member in archive:
            name = '/' + member.name.lstrip('./')
            parts = PurePosixPath(name).parts
            for i, part in enumerate(parts):
                if part in ('.cache', '.npm', '.yarn', '.pnpm-store', 'it_core_news_sm'):
                    path = str(PurePosixPath(*parts[:i + 1]))
                    paths.setdefault(path, dict(path=path, status='present', logical_bytes=0,
                                                allocated_bytes=None, reason='export_has_logical_sizes_only'))
            for path, item in paths.items():
                if name == path or name.startswith(path.rstrip('/') + '/'):
                    item['status'] = 'present'
                    item['logical_bytes'] = (item['logical_bytes'] or 0) + (member.size if member.isfile() else 0)
    return sorted(paths.values(), key=lambda item: item['path'])


DISK_SCRIPT = r'''
for path do
    if [ -e "$path" ] || [ -L "$path" ]; then
        if value=$(du -sk -- "$path" 2>/dev/null); then
            set -- $value
            printf '%s\tpresent\t%s\n' "$path" "$1"
        else
            printf '%s\tunreadable\t-\n' "$path"
        fi
    else
        parent=${path%/*}
        while [ ! -e "$parent" ] && [ "$parent" != "" ]; do parent=${parent%/*}; done
        if [ -x "${parent:-/}" ]; then
            printf '%s\tabsent\t-\n' "$path"
        else
            printf '%s\tunreadable\t-\n' "$path"
        fi
    fi
done
'''



def remaining(deadline, cap=10.):
    value = min(cap, deadline - time.monotonic())
    if value <= 0:
        raise TimeoutError('DEADLINE')
    return value


def docker_command(args, timeout):
    try:
        result = subprocess.run(['docker', *args], capture_output=True, timeout=timeout, check=False)
    except subprocess.TimeoutExpired:
        raise TimeoutError('DOCKER_TIMEOUT') from None
    if result.returncode:
        raise RuntimeError('DOCKER_COMMAND_FAILED')
    return result.stdout.decode('utf-8')


class Docker:
    label = 'resource-stress.owner'

    def __init__(self, token, *, command=docker_command):
        self.token = token
        self.command = command
        self.owned = {}
        self.pending_names = set()

    def preflight(self, images, cpus, memory, deadline):
        import platform
        if self.call(['ps', '-q'], deadline).strip():
            raise ValueError('INTERFERING_CONTAINERS')
        info = json.loads(self.call(['info', '--format', '{{json .}}'], deadline))
        native = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine(), platform.machine())
        architecture = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(info['Architecture'], info['Architecture'])
        if (str(info.get('CgroupVersion')) != '2' or info['NCPU'] < cpus or
                info['MemTotal'] <= memory or architecture != native):
            raise ValueError('HOST_LIMITS_OR_ARCHITECTURE')
        result = dict(host={k: info.get(k) for k in ('NCPU', 'MemTotal', 'CgroupVersion', 'Architecture', 'ServerVersion')}, images={})
        cache_keys = {'HF_HOME', 'HF_HUB_CACHE', 'TRANSFORMERS_CACHE', 'XDG_CACHE_HOME', 'UV_CACHE_DIR',
                      'npm_config_cache', 'HUGGINGFACE_HUB_CACHE', 'TORCH_HOME', 'ONNX_CACHE_DIR'}
        for engine, image in images.items():
            data = json.loads(self.call(['image', 'inspect', image], deadline))[0]
            if data['Architecture'] != native or data['Os'] != 'linux' or data['Config'].get('Volumes'):
                raise ValueError('IMAGE_ARCH_OR_VOLUMES')
            cache_paths = []
            for value in data['Config'].get('Env') or []:
                key, _, path = value.partition('=')
                if key in cache_keys:
                    if not path.startswith('/') or any(c in path for c in '\n\r\t'):
                        raise ValueError('CACHE_PATH_NOT_ABSOLUTE')
                    cache_paths.append(path.rstrip('/'))
            result['images'][engine] = dict(id=data['Id'], architecture=data['Architecture'],
                logical_bytes=data['Size'], runtime={'entrypoint': data['Config'].get('Entrypoint'), 'cmd': data['Config'].get('Cmd')},
                cache_paths=sorted(set(cache_paths)), provenance='operator_verified_source_image')
        return result

    def call(self, args, deadline, cap=10.):
        return self.command(args, remaining(deadline, cap))

    def inspect(self, target, deadline, size=False):
        return json.loads(self.call(['inspect', *(['--size'] if size else []), target], deadline))[0]

    def create(self, engine, image, cpus, memory, deadline):
        name = 'resource-stress-' + self.token + '-' + engine
        self.pending_names.add(name)  # A timed-out create may still have succeeded.
        args = ['create', '--pull=never', '--name', name, '--label', self.label + '=' + self.token,
                '--cpus', str(cpus), '--memory', str(memory), '--memory-swap', str(memory),
                '--restart=no', '-p', '127.0.0.1::8000']
        if engine in ('horizon', 'presidio'):
            args += ['-e', 'ANALYZER_BIND_HOST=0.0.0.0']
        cid = self.call([*args, image], deadline).strip()
        if not re.fullmatch(r'[0-9a-f]{64}', cid):
            raise ValueError('CONTAINER_ID')
        self.owned[cid] = name
        self.pending_names.discard(name)
        self.verify(cid, deadline)
        return cid

    def verify(self, cid, deadline):
        info = self.inspect(cid, deadline)
        if (cid not in self.owned or info['Id'] != cid or
                info['Name'] != '/' + self.owned[cid] or
                info.get('Config', {}).get('Labels', {}).get(self.label) != self.token):
            raise ValueError('OWNERSHIP_MISMATCH')
        return info

    def start(self, cid, cpus, memory, deadline):
        self.verify(cid, deadline)
        self.call(['start', cid], deadline)
        info = self.verify(cid, deadline)
        limits = info['HostConfig']
        if (limits['NanoCpus'] != round(cpus * 1e9) or limits['Memory'] != memory or
                limits['MemorySwap'] != memory or not info['State']['Running']):
            raise ValueError('LIMIT_OR_STATE_MISMATCH')
        bindings = info['NetworkSettings']['Ports']['8000/tcp']
        if len(bindings) != 1 or bindings[0]['HostIp'] != '127.0.0.1':
            raise ValueError('LOOPBACK_REQUIRED')
        return int(bindings[0]['HostPort'])

    def static_inventory(self, cid, configured, deadline):
        info = self.verify(cid, deadline)
        if info['State']['Running']:
            raise ValueError('STATIC_SCAN_REQUIRES_STOPPED_CONTAINER')
        export = subprocess.Popen(['docker', 'export', cid], stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
        scan = None
        try:
            scan = subprocess.Popen([sys.executable, str(Path(__file__).resolve()), '--inventory', json.dumps(configured)],
                                    stdin=export.stdout, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            export.stdout.close()
            output, _ = scan.communicate(timeout=remaining(deadline, 120.))
            export.wait(timeout=remaining(deadline, 5.))
            if scan.returncode or export.returncode:
                raise RuntimeError('STATIC_INVENTORY_FAILED')
            return dict(paths=json.loads(output), method='stopped_container_export_logical',
                        cache_warning='May warm Docker VM page cache; no cold-cache claim')
        except subprocess.TimeoutExpired:
            raise TimeoutError('STATIC_INVENTORY_TIMEOUT') from None
        finally:
            for process in (scan, export):
                if process is not None and process.poll() is None:
                    process.kill()
                    process.wait(timeout=1.)
            if not export.stdout.closed:
                export.stdout.close()

    def post_inventory(self, cid, paths, deadline, *, collector_stopped):
        if not collector_stopped:
            raise ValueError('DISK_DURING_PERFORMANCE')
        if deadline - time.monotonic() < 1.:
            return dict(paths=None, reason='budget_exhausted')
        try:
            self.verify(cid, deadline)
            raw = self.call(['exec', '--user', '0', cid, 'sh', '-c', DISK_SCRIPT, 'disk-inventory', *paths], deadline)
            result = []
            for line in raw.splitlines():
                path, status, value = line.split('\t')
                result.append(dict(path=path, status=status,
                                   allocated_bytes=int(value) * 1024 if status == 'present' else None))
            info = self.inspect(cid, deadline, size=True)
            return dict(paths=result, writable_bytes=info.get('SizeRw'), rootfs_bytes=info.get('SizeRootFs'),
                        method='du_kib_allocated_root_and_docker_inspect')
        except (RuntimeError, TimeoutError, ValueError):
            return dict(paths=None, reason='post_inventory_failed_or_deadline')

    def cleanup(self, deadline, only=None):
        results = {}
        for name in list(self.pending_names):
            try:
                info = self.inspect(name, deadline)
                if info.get('Config', {}).get('Labels', {}).get(self.label) != self.token or info['Name'] != '/' + name:
                    results[name] = False
                    continue
                self.owned[info['Id']] = name
                self.pending_names.discard(name)
            except (RuntimeError, ValueError, TimeoutError):
                results[name] = False
        for cid in list(self.owned):
            if only is not None and cid != only:
                continue
            try:
                self.verify(cid, deadline)
                self.call(['rm', '-f', cid], deadline)
                ids = self.call(['ps', '-aq', '--no-trunc', '--filter', 'id=' + cid], deadline).split()
                results[cid] = cid not in ids
                if results[cid]:
                    del self.owned[cid]
            except (RuntimeError, ValueError, TimeoutError):
                results[cid] = False
        return results


# Only static code goes to the shell. The host requests one frame per second;
# EOF/stop exits the shell, unlike killing a detached docker-exec sleep loop.
COLLECTOR_SCRIPT = r'''
while IFS= read -r command; do
    [ "$command" = sample ] || break
    read -r now rest < /proc/uptime
    printf 'BEGIN %s\n' "$now"
    for name in memory.current memory.max memory.peak memory.stat memory.events memory.swap.current cpu.stat cpu.max; do
        if [ "$name" = cpu.stat ]; then
            read -r now rest < /proc/uptime
            printf 'CPU_BEGIN %s\n' "$now"
        fi
        printf '@%s\n' "$name"
        cat "/sys/fs/cgroup/$name" 2>/dev/null || :
        if [ "$name" = cpu.stat ]; then
            read -r now rest < /proc/uptime
            printf 'CPU_END %s\n' "$now"
        fi
    done
    for path in /proc/[0-9]*/status; do
        pid=${path#/proc/}; pid=${pid%/status}
        printf '@proc:%s\n' "$pid"
        awk '/^(Name|Pid|PPid|VmRSS):/' "$path" 2>/dev/null || :
    done
    read -r now rest < /proc/uptime
    printf 'END %s\n' "$now"
done
'''


def safety_reason(sample, baseline=None):
    if any(sample.get(k) is None for k in ('memory_current', 'memory_max', 'oom', 'oom_kill')):
        return 'telemetry_required_missing'
    if sample['memory_current'] >= .9 * sample['memory_max']:
        return 'memory_guard'
    if any(sample[k] > (baseline or {}).get(k, 0) for k in ('oom', 'oom_kill')):
        return 'oom_guard'
    return None


class Collector:
    def __init__(self, container, cpus, *, launch=subprocess.Popen):
        self.process = launch(['docker', 'exec', '-i', container, 'sh', '-c', COLLECTOR_SCRIPT],
                              stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                              bufsize=0)
        os.set_blocking(self.process.stdout.fileno(), False)
        self.cpus = cpus
        self.samples = []
        self.buffer = b''
        self.frame = []
        self.last_received = time.monotonic()
        self.next_read = 0.
        self.waiting = False
        self.failure = None
        self.stopped = False

    def poll(self):
        if self.stopped:
            return
        now = time.monotonic()
        if not self.waiting and now >= self.next_read:
            try:
                self.process.stdin.write(b'sample\n')
                self.waiting = True
                self.next_read = now + 1.
            except (OSError, ValueError):
                self.failure = 'collector_exited'
        try:
            while True:
                block = os.read(self.process.stdout.fileno(), 65536)
                if not block:
                    break
                self.buffer += block
                if len(self.buffer) > 1048576:
                    self.failure = 'collector_frame_too_large'
                    break
        except BlockingIOError:
            pass
        while b'\n' in self.buffer:
            line, self.buffer = self.buffer.split(b'\n', 1)
            decoded = line.decode('utf-8', 'replace')
            if decoded.startswith('BEGIN '):
                self.frame = []
            self.frame.append(decoded)
            if decoded.startswith('END '):
                try:
                    sample = parse_frame('\n'.join(self.frame), now, self.cpus,
                                         self.samples[-1] if self.samples else None)
                    self.samples.append(sample)
                    self.last_received = now
                    self.waiting = False
                except (ValueError, KeyError):
                    self.failure = 'collector_invalid_frame'
                self.frame = []
        if self.process.poll() is not None:
            self.failure = 'collector_exited'

    def guard(self):
        self.poll()
        if self.failure:
            return self.failure
        if time.monotonic() - self.last_received > 3.:
            return 'telemetry_lost'
        return safety_reason(self.samples[-1]) if self.samples else None

    def stop(self, deadline):
        self.stopped = True
        graceful = False
        try:
            self.process.stdin.write(b'stop\n')
            self.process.stdin.close()
            self.process.wait(timeout=max(.001, min(1., deadline - time.monotonic())))
            graceful = self.process.returncode == 0
        except (OSError, ValueError, subprocess.TimeoutExpired):
            self.process.kill()
            try:
                self.process.wait(timeout=.2)
            except subprocess.TimeoutExpired:
                pass
        finally:
            self.process.stdout.close()
            if not self.process.stdin.closed:
                self.process.stdin.close()
        return graceful



def parse_frame(text, received, cpus, previous=None):
    sections = {}
    key = None
    begin = end = cpu_begin = cpu_end = None
    for line in text.splitlines():
        if line.startswith('BEGIN '):
            begin = float(line.split()[1])
        elif line.startswith('END '):
            end = float(line.split()[1])
        elif line.startswith('CPU_BEGIN '):
            cpu_begin = float(line.split()[1])
        elif line.startswith('CPU_END '):
            cpu_end = float(line.split()[1])
        elif line.startswith('@'):
            key = line[1:]
            sections[key] = []
        elif key:
            sections[key].append(line)
    if begin is None or end is None or end < begin:
        raise ValueError('INCOMPLETE_FRAME')
    bracketed = cpu_begin is not None and cpu_end is not None and begin <= cpu_begin <= cpu_end <= end
    cpu_time, cpu_read_seconds = begin, None
    if bracketed:
        assert cpu_begin is not None and cpu_end is not None
        cpu_time = (cpu_begin + cpu_end) / 2
        cpu_read_seconds = cpu_end - cpu_begin
    sample: dict = dict(time=received, cgroup_time=begin, cpu_time=cpu_time,
                  cpu_time_source='cpu_stat_midpoint' if bracketed else 'frame_begin_legacy',
                  cpu_read_seconds=cpu_read_seconds,
                  read_seconds=end - begin,
                  gap_seconds=received - previous['time'] if previous else None, missing={})

    def number(name, section, field=None):
        lines = sections.get(section, [])
        value = None
        try:
            if field:
                value = int(dict(line.split(None, 1) for line in lines)[field])
            elif lines:
                value = int(lines[0])
        except (ValueError, KeyError):
            pass
        if value is None:
            sample['missing'][name] = 'absent_unreadable_or_unlimited'
        sample[name] = value
        return value

    for filename in ('memory.current', 'memory.max', 'memory.peak', 'memory.swap.current'):
        number(filename.replace('.', '_'), filename)
    for field in ('anon', 'file', 'shmem', 'kernel'):
        number(field, 'memory.stat', field)
    for field in ('oom', 'oom_kill'):
        number(field, 'memory.events', field)
    for field in ('usage_usec', 'nr_throttled', 'throttled_usec'):
        number(field, 'cpu.stat', field)
    sample['cpu_max'] = ' '.join(sections.get('cpu.max', [])) or None
    sample['processes'] = []
    for section, lines in sections.items():
        if not section.startswith('proc:'):
            continue
        status = dict(line.split(':', 1) for line in lines if ':' in line)
        rss = status.get('VmRSS', '').strip().split()
        sample['processes'].append(dict(pid=int(section.split(':')[1]),
                                       ppid=int(status.get('PPid', '-1')),
                                       rss=int(rss[0]) * 1024 if rss else None,
                                       name=status.get('Name', '').strip()))
    sample.update(cpu_cores=None, cpu_budget_percent=None, delta_nr_throttled=None, delta_throttled_usec=None)
    if previous:
        dt = cpu_time - previous.get('cpu_time', previous['cgroup_time'])
        for field in ('usage_usec', 'nr_throttled', 'throttled_usec'):
            before, after = previous[field], sample[field]
            if dt <= 0 or before is None or after is None or after < before:
                sample['missing']['cpu_delta'] = 'counter_reset_missing_or_clock'
                continue
            delta = after - before
            if field == 'usage_usec':
                sample['cpu_cores'] = delta / (dt * 1e6)
                sample['cpu_budget_percent'] = sample['cpu_cores'] / cpus * 100
            else:
                sample['delta_' + field] = delta
    return sample


if __name__ == '__main__':
    if len(sys.argv) != 3 or sys.argv[1] != '--inventory':
        raise SystemExit(2)
    print(json.dumps(scan_tar(sys.stdin.buffer, json.loads(sys.argv[2]))))
