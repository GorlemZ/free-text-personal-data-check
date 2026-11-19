#!/usr/bin/env python3
"""Controlled HTTP length workload for the four containerized detectors."""
import collections
import hashlib
import http.client
import json
import math
import socket
import time
from typing import Any

import run

LENGTHS = {'A': 10, 'B': 50, 'C': 150, 'D': 1000}
TOKENS = ('dato', 'nota', 'test')


def cases(band):
    size = LENGTHS[band]
    if band == 'D':
        # All four HTTP validators cap a field at 50 whitespace-delimited words.
        return [dict(id=f'D-{index}', text=' '.join([(token * 5)[:19]] * 50) + '.')
                for index, token in enumerate(TOKENS)]
    return [dict(id=f'{band}-{index}', text=(token + ' ') * (size // 5 - 1) + token + '.')
            for index, token in enumerate(TOKENS)]


def sequence(band_cases, count):
    return [band_cases[index % len(band_cases)] for index in range(count)]


def snapshot(docker, cid, cpus, memory, deadline):
    """Small pre/post cgroup read, outside the timed HTTP sequence."""
    script = ("printf '@cpu\\n'; cat /sys/fs/cgroup/cpu.stat; "
              "printf '@memory\\n'; cat /sys/fs/cgroup/memory.current; "
              "printf '@max\\n'; cat /sys/fs/cgroup/memory.max; "
              "printf '@events\\n'; cat /sys/fs/cgroup/memory.events; "
              "printf '@quota\\n'; cat /sys/fs/cgroup/cpu.max")
    raw = docker.call(['exec', cid, 'sh', '-c', script], deadline)
    sampled_at = time.monotonic()
    sections = {}
    current = None
    for line in raw.splitlines():
        if line.startswith('@'):
            current = line[1:]
            sections[current] = []
        elif current:
            sections[current].append(line)
    try:
        stat = dict(line.split()[:2] for line in sections['cpu'])
        events = dict(line.split()[:2] for line in sections['events'])
        quota, period = map(int, sections['quota'][0].split())
        result = dict(usage_usec=int(stat['usage_usec']), sample_time=sampled_at,
                      memory_current=int(sections['memory'][0]), memory_max=int(sections['max'][0]),
                      oom=int(events['oom']), oom_kill=int(events['oom_kill']),
                      cpu_max=sections['quota'][0])
        if (result['memory_max'] != memory or not math.isclose(quota / period, cpus)
                or result['memory_current'] < 0 or result['usage_usec'] < 0
                or result['oom'] or result['oom_kill']):
            raise ValueError('CGROUP_LIMITS_OR_OOM')
        return result
    except (KeyError, IndexError, TypeError, ValueError, ZeroDivisionError) as exc:
        raise ValueError('CGROUP_LIMITS_OR_OOM') from exc


def cpu_average(before, after):
    """CPU cores across the entire snapshot bracket, including observer work."""
    duration = after['sample_time'] - before['sample_time']
    delta = after['usage_usec'] - before['usage_usec']
    if duration <= 0 or delta < 0:
        raise ValueError('CGROUP_CPU_COUNTER')
    return delta / 1e6 / duration


def request_batch(port, band_cases, *, count, timeout, guard):
    """Exactly one keepalive HTTP request at a time, fixed cyclic sequence."""
    observations = []
    connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
    start = time.monotonic()
    stop_reason = None
    try:
        for case in sequence(band_cases, count):
            stop_reason = guard()
            if stop_reason:
                break
            request_start = time.monotonic()
            status, code = 'success', None
            try:
                body = json.dumps(run.payload({'fields': [dict(fieldId='text', text=case['text'])]}),
                                  separators=(',', ':')).encode('ascii')
                connection.request('POST', '/v1/analyze', body=body,
                                   headers={'Content-Type': 'application/json', 'Connection': 'keep-alive'})
                response = connection.getresponse()
                result = response.read(1048577)
                if len(result) > 1048576:
                    raise ValueError('RESPONSE_TOO_LARGE')
                if response.status != 200:
                    status, code = 'http_error', 'HTTP_' + str(response.status)
                else:
                    value = json.loads(result, object_pairs_hook=run.evaluation.unique_object)
                    run.evaluation.project_response(value)
            except (socket.timeout, TimeoutError):
                status, code = 'timeout', 'SOCKET_TIMEOUT'
                stop_reason = 'server_drain_unknown'
            except (OSError, http.client.HTTPException):
                status, code = 'transport_error', 'TRANSPORT_ERROR'
                stop_reason = 'server_drain_unknown'
            except (ValueError, UnicodeError):
                status, code = 'contract_error', 'INVALID_RESPONSE'
                connection.close()
                connection = http.client.HTTPConnection('127.0.0.1', port, timeout=timeout)
            observations.append(dict(caseId=case['id'], status=status, code=code,
                                     seconds=time.monotonic() - request_start))
            if stop_reason:
                break
    finally:
        connection.close()
    finish = time.monotonic()
    elapsed = finish - start
    counts = collections.Counter(item['status'] for item in observations)
    latencies = [item['seconds'] for item in observations if item['status'] == 'success']
    return dict(offered=count, completed=len(observations), success=counts['success'],
                http_error=counts['http_error'], contract_error=counts['contract_error'],
                transport_error=counts['transport_error'], timeout=counts['timeout'],
                max_inflight=1 if observations else 0, start_monotonic=start, end_monotonic=finish,
                elapsed_seconds=elapsed,
                throughput=counts['success'] / elapsed if elapsed else None,
                p50_seconds=run.percentile(latencies, .5), p95_seconds=run.percentile(latencies, .95),
                error_codes=dict(sorted(collections.Counter(o['code'] for o in observations if o['code']).items())),
                observations=observations, stop_reason=stop_reason)


def measure_engine(engine, image, count, output, *, bands=tuple(LENGTHS)):
    """One fresh pinned-image container; preserve partial receipt and owned cleanup."""
    import telemetry
    import uuid
    cpus, memory = 1, 4 * 1024 ** 3
    docker = telemetry.Docker(uuid.uuid4().hex[:16])
    receipt: dict[str, Any] = dict(engine=engine, image_tag=image, image_id=None,
                   cpus=cpus, memory_bytes=memory, requests_per_band=count,
                   selected_bands=list(bands),
                   warmup_requests_per_band=3, active_client_requests=1,
                   onnx_threads={'intra_op': 1, 'inter_op': 1} if engine != 'presidio' else None,
                   stages={}, complete=False, cleanup=False, stop_reason=None, incidents=[])
    cid = None
    collector = None
    deadline = time.monotonic() + 300

    def persist():
        target = output / 'results.json'
        temporary = output / 'results.json.partial'
        temporary.write_text(json.dumps(receipt, indent=2, sort_keys=True, allow_nan=False) + '\n')
        temporary.replace(target)

    try:
        preflight = docker.preflight({engine: image}, cpus, memory, deadline)
        receipt['image_id'] = preflight['images'][engine]['id']
        env = {'ANALYZER_CONCURRENCY': '1'} if engine != 'presidio' else {
            'OMP_NUM_THREADS': '1', 'OPENBLAS_NUM_THREADS': '1', 'MKL_NUM_THREADS': '1'}
        cid = docker.create(engine, receipt['image_id'], cpus, memory, deadline, env=env)
        receipt['configured_env'] = env
        port = docker.start(cid, cpus, memory, deadline)
        collector = telemetry.Collector(cid, cpus)
        launched = time.monotonic()

        def guard():
            if time.monotonic() >= deadline - 25:
                return 'engine_budget_exhausted'
            collector.poll()
            if collector.failure:
                return collector.failure
            if not collector.samples and time.monotonic() - launched > 15:
                return 'telemetry_lost'
            if collector.samples:
                sample = collector.samples[-1]
                return (telemetry.safety_reason(sample) or
                        run.cgroup_limits_status(sample, cpus, memory) or
                        run.oom_telemetry_status(sample))
            return None

        reason = run.wait_ready(port, min(deadline - 25, time.monotonic() + 90), guard)
        if reason:
            receipt['stop_reason'] = reason
        else:
            for band in bands:
                band_cases = cases(band)
                warmup = request_batch(port, band_cases, count=3, timeout=15, guard=guard)
                receipt['stages'][band] = dict(length=LENGTHS[band],
                    warmup=dict(completed=warmup['completed'], success=warmup['success'],
                                error_codes=warmup['error_codes'], stop_reason=warmup['stop_reason']),
                    complete=False)
                if warmup['success'] != 3 or warmup['stop_reason']:
                    receipt['stop_reason'] = 'warmup_failed'
                    break
                before = snapshot(docker, cid, cpus, memory, deadline - 20)
                stage = request_batch(port, band_cases, count=count, timeout=15, guard=guard)
                after = snapshot(docker, cid, cpus, memory, deadline - 20)
                samples = [s for s in collector.samples if stage['start_monotonic'] <= s['time'] <= stage['end_monotonic']]
                if after['usage_usec'] < before['usage_usec'] or after['oom'] > before['oom'] or after['oom_kill'] > before['oom_kill']:
                    receipt['stop_reason'] = 'cgroup_counter_or_oom'
                stage['cpu_cores_average'] = cpu_average(before, after)
                stage['cpu_bracket_seconds'] = after['sample_time'] - before['sample_time']
                stage['memory_current_max_sampled'] = max([before['memory_current'], after['memory_current']] +
                                                           [s['memory_current'] for s in samples if type(s.get('memory_current')) is int])
                stage['container_lifetime_memory_peak_cgroup'] = max([s['memory_peak'] for s in samples if type(s.get('memory_peak')) is int], default=None)
                stage['memory_evidence'] = 'in_window_samples' if samples else 'boundary_snapshots_only'
                stage['cgroup_sample_count'] = len(samples)
                stage['complete'] = (stage['completed'] == count and stage['success'] == count and
                                     stage['stop_reason'] is None and receipt['stop_reason'] is None)
                receipt['stages'][band]['measurement'] = stage
                receipt['stages'][band]['complete'] = stage['complete']
                persist()
                if stage['stop_reason'] or receipt['stop_reason']:
                    receipt['stop_reason'] = receipt['stop_reason'] or stage['stop_reason']
                    break
            if receipt['stop_reason'] is None and len(receipt['stages']) == len(bands):
                receipt['complete'] = all(stage['complete'] for stage in receipt['stages'].values())
    except KeyboardInterrupt:
        receipt['stop_reason'] = 'interrupted'
    except (OSError, RuntimeError, ValueError, TimeoutError) as exc:
        receipt['stop_reason'] = type(exc).__name__ + '_during_engine'
    finally:
        if collector:
            try:
                collector.poll()
                if collector.failure:
                    receipt['incidents'].append('collector_failed')
            except Exception:
                receipt['incidents'].append('collector_poll_failed')
            try:
                receipt['collector_stopped'] = collector.stop(time.monotonic() + 3)
            except Exception:
                receipt['collector_stopped'] = False
                receipt['incidents'].append('collector_shutdown_failed')
            receipt['telemetry_sample_count'] = len(collector.samples)
            receipt['memory_max_sampled'] = max((s['memory_current'] for s in collector.samples
                if type(s.get('memory_current')) is int), default=None)
            if not receipt['collector_stopped'] or not collector.samples:
                receipt['incidents'].append('collector_incomplete')
        if cid:
            try:
                state = docker.verify(cid, time.monotonic() + 10)['State']
                receipt['final_state'] = {k: state.get(k) for k in ('Running', 'OOMKilled', 'ExitCode')}
                receipt['stop_reason'] = receipt['stop_reason'] or run.final_state_status(receipt['final_state'])
            except Exception:
                receipt['incidents'].append('state_unavailable')
        try:
            cleanup = docker.cleanup(time.monotonic() + 20)
            receipt['cleanup'] = bool(cleanup) and all(cleanup.values()) and not docker.owned and not docker.pending_names
        except Exception:
            receipt['cleanup'] = False
        if not receipt['cleanup']:
            receipt['incidents'].append('cleanup_unverified')
        if time.monotonic() > deadline:
            receipt['incidents'].append('deadline_overrun')
        receipt['complete'] = (receipt['complete'] and receipt['stop_reason'] is None and not receipt['incidents']
                               and receipt['cleanup'] and receipt.get('telemetry_sample_count', 0) > 0)
        persist()
    return receipt


def main(argv=None):
    import argparse
    from pathlib import Path
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    parser.add_argument('--engine', action='append', choices=run.ENGINES)
    band_options = parser.add_mutually_exclusive_group()
    band_options.add_argument('--band', choices=tuple(LENGTHS), help='Run only one length band')
    band_options.add_argument('--bands', help='Run an ordered subset, e.g. A,B,C (default: A,B,C,D)')
    parser.add_argument('--count', type=int, default=60)
    args = parser.parse_args(argv)
    if args.count < 6 or args.count > 300 or args.count % len(TOKENS):
        parser.error('--count must be a multiple of 3 between 6 and 300')
    bands = tuple(args.bands.split(',')) if args.bands is not None else ((args.band,) if args.band else tuple(LENGTHS))
    if not bands or len(set(bands)) != len(bands) or any(band not in LENGTHS for band in bands):
        parser.error('--bands must contain unique, comma-separated bands from A,B,C,D')
    selected = tuple(dict.fromkeys(args.engine or run.ENGINES))
    args.output.mkdir(parents=True, exist_ok=False)
    summary = {}
    for engine in selected:
        output = args.output / engine
        output.mkdir()
        image = 'local/dpia-' + engine + ':multi-poc-current'
        result = measure_engine(engine, image, args.count, output, bands=bands)
        summary[engine] = dict(complete=result['complete'], cleanup=result['cleanup'],
                               stop_reason=result['stop_reason'])
        print(json.dumps({engine: summary[engine]}), flush=True)
        if not result['cleanup']:
            break
    (args.output / 'summary.json').write_text(json.dumps(summary, indent=2, sort_keys=True) + '\n')
    return 0 if len(summary) == len(selected) and all(value['complete'] for value in summary.values()) else 2


if __name__ == '__main__':
    raise SystemExit(main())
