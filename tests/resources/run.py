#!/usr/bin/env python3
"""Bounded, sequential Docker resource experiment; stdlib only, explicit opt-in."""
import collections
import http.client
import math
import multiprocessing
import socket
import threading
import time
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import types
from dataclasses import dataclass, asdict
import uuid
import csv
import telemetry


@dataclass(frozen=True)
class Protocol:
    engine_seconds: float = 95.
    readiness: float = 20.
    idle: float = 5.
    warmup: float = 10.
    window: float = 10.
    recovery: float = 5.
    drain: float = 5.
    reserve: float = 15.
    socket_timeout: float = 5.
    engine_cleanup: float = 2.


ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location('resource_evaluation', ROOT / 'tests/evaluation/runner.py')
evaluation = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(evaluation)
ENGINES = ('rizzo', 'horizon', 'presidio')


def ordered_cases(cases):
    return sorted(cases, key=lambda c: hashlib.sha256(c['id'].encode()).hexdigest())


def load_gold(path):
    gold = json.loads(Path(path).read_text(encoding='utf-8'), object_pairs_hook=evaluation.unique_object)
    # Reuse every structural/annotation check without changing the shared loader,
    # its globals, or the input. Sources are corpus metadata, not engine names.
    sources = {c['source'] for c in gold.get('cases', [])}
    if not all(isinstance(s, str) and re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', s) for s in sources):
        raise ValueError('SOURCE')
    scope = dict(evaluation.__dict__, SOURCES=sorted(sources))
    scope['validate_cases'] = types.FunctionType(evaluation.validate_cases.__code__, scope,
                                                argdefs=evaluation.validate_cases.__defaults__)
    types.FunctionType(evaluation.validate_gold.__code__, scope)(gold)
    return ordered_cases(gold['cases'])


def payload(case):
    return evaluation.payload_for(case, 'detection')


def stage_admissible(now, deadline, socket_timeout=5.):
    return deadline - now >= socket_timeout


def _load_child(pipe, host, port, cases, concurrency, timeout):
    """Threads own HTTP connections; parent can terminate the entire process."""
    lock = threading.Lock()
    stopped = threading.Event()
    sequence = 0
    pipe.send(('ready',))
    start, end, deadline = pipe.recv()

    def worker():
        nonlocal sequence
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
        try:
            while not stopped.is_set():
                with lock:
                    now = time.monotonic()
                    if now >= end or deadline - now < timeout:
                        break
                    index = sequence
                    sequence += 1
                    case = cases[index % len(cases)]
                    pipe.send(('start', index, case['id'], now))
                status = 'success'
                code = None
                try:
                    connection.request('POST', '/v1/analyze', body=json.dumps(payload(case)).encode(),
                                       headers={'Content-Type': 'application/json', 'Connection': 'keep-alive'})
                    response = connection.getresponse()
                    body = response.read(1048577)
                    if len(body) > 1048576:
                        raise ValueError('RESPONSE_TOO_LARGE')
                    if response.status != 200:
                        status, code = 'http_error', 'HTTP_' + str(response.status)
                    else:
                        try:
                            value = json.loads(body, object_pairs_hook=evaluation.unique_object)
                        except (ValueError, UnicodeError):
                            raise ValueError('INVALID_JSON') from None
                        evaluation.project_response(value, case)
                except (socket.timeout, TimeoutError):
                    status, code = 'timeout', 'SOCKET_TIMEOUT'
                    stopped.set()
                except ValueError:
                    status, code = 'contract_error', 'INVALID_RESPONSE'
                    connection.close()
                except (OSError, http.client.HTTPException):
                    status, code = 'transport_error', 'TRANSPORT_ERROR'
                    stopped.set()
                with lock:
                    pipe.send(('finish', index, time.monotonic(), status, code))
        finally:
            connection.close()

    threads = [threading.Thread(target=worker, daemon=True) for _ in range(concurrency)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()
    pipe.send(('done',))
    pipe.close()


def run_stage(host, port, cases, concurrency, duration, deadline, *, socket_timeout=5.,
              drain_budget=5., guard=lambda: None):
    """One global sequence per stage; socket deadlines never follow window ends."""
    context = multiprocessing.get_context('spawn')
    parent, child = context.Pipe()
    process = context.Process(target=_load_child,
                              args=(child, host, port, cases, concurrency, socket_timeout), daemon=True)
    records = {}
    started = time.monotonic()
    end = started
    stage = dict(concurrency=concurrency, start=started, end=started, drain_end=started,
                 observations=[], max_inflight=0, drained=False, stop_reason=None)
    done = False
    inflight = 0
    process.start()
    child.close()
    try:
        ready_limit = min(deadline, time.monotonic() + 3.)
        while not parent.poll(.01):
            reason = guard()
            if reason or time.monotonic() >= ready_limit or not process.is_alive():
                stage['stop_reason'] = reason or 'load_process_start_failed'
                return stage
        if parent.recv() != ('ready',):
            raise RuntimeError('LOAD_PROTOCOL')
        start = time.monotonic()
        if not stage_admissible(start, deadline, socket_timeout + duration):
            stage.update(start=start, end=start, drain_end=start, stop_reason='stage_budget_exhausted')
            return stage
        end = min(start + duration, deadline)
        stage.update(start=start, end=end)
        parent.send((start, end, deadline))
        drain_limit = min(deadline, end + max(0., drain_budget - (start - started)))
        while True:
            now = time.monotonic()
            reason = guard()
            if reason or now >= drain_limit:
                stage['stop_reason'] = reason or 'budget_cancelled'
                stage['end'] = min(end, now)
                break
            if parent.poll(.01):
                try:
                    event = parent.recv()
                except EOFError:
                    stage['stop_reason'] = 'load_process_exited'
                    break
                if event[0] == 'start':
                    _, index, case_id, timestamp = event
                    records[index] = dict(index=index, caseId=case_id, start=timestamp, finish=None,
                                          status='pending', code=None)
                    inflight += 1
                    stage['max_inflight'] = max(stage['max_inflight'], inflight)
                elif event[0] == 'finish':
                    _, index, timestamp, status, code = event
                    records[index].update(finish=timestamp, status=status, code=code)
                    inflight -= 1
                    if status in ('timeout', 'transport_error'):
                        stage['stop_reason'] = 'server_drain_unknown'
                        stage['end'] = min(end, timestamp)
                        break
                elif event[0] == 'done':
                    done = True
                    # Preserve the configured window when a final response finishes early.
                    while time.monotonic() < end:
                        reason = guard()
                        if reason:
                            stage['stop_reason'] = reason
                            stage['end'] = time.monotonic()
                            break
                        time.sleep(min(.01, max(0, end - time.monotonic())))
                    break
        stage['drain_end'] = time.monotonic()
        for record in records.values():
            if record['status'] == 'pending':
                record.update(status='cancelled', code='BUDGET_OR_GUARD', finish=stage['drain_end'])
        stage['observations'] = list(records.values())
        stage['drained'] = done and stage['stop_reason'] is None
        return stage
    except KeyboardInterrupt:
        stage['stop_reason'] = 'interrupted'
        stage['end'] = min(stage['end'], time.monotonic())
        stage['drain_end'] = time.monotonic()
        for record in records.values():
            if record['status'] == 'pending':
                record.update(status='cancelled', code='BUDGET_OR_GUARD', finish=stage['drain_end'])
        stage['observations'] = list(records.values())
        return stage
    finally:
        if process.is_alive():
            process.terminate()
        process.join(.2)
        if process.is_alive():
            process.kill()
            process.join(.2)
        # A guard can run while the child queues events. Read the bounded pipe
        # after termination before classifying unfinished attempts as cancelled.
        if stage['stop_reason']:
            until = time.monotonic() + .1
            while time.monotonic() < until and parent.poll(0):
                try:
                    event = parent.recv()
                except (EOFError, OSError):
                    break
                if event[0] == 'start':
                    _, index, case_id, timestamp = event
                    records[index] = dict(index=index, caseId=case_id, start=timestamp,
                                          finish=None, status='pending', code=None)
                    inflight += 1
                    stage['max_inflight'] = max(stage['max_inflight'], inflight)
                elif event[0] == 'finish':
                    _, index, timestamp, status, code = event
                    records[index].update(finish=timestamp, status=status, code=code)
                    inflight -= 1
            now = time.monotonic()
            if records:
                stage['end'] = min(end, now)
            stage['drain_end'] = now
            for record in records.values():
                if record['status'] in ('pending', 'cancelled'):
                    record.update(status='cancelled', code='BUDGET_OR_GUARD', finish=now)
            stage['observations'] = list(records.values())
        parent.close()
        if not process.is_alive():
            process.close()


def percentile(values, fraction):
    return sorted(values)[max(0, math.ceil(len(values) * fraction) - 1)] if values else None


def stage_metrics(stage, metadata):
    observations = stage['observations']
    successes = [o for o in observations if o['status'] == 'success']
    window = [o for o in successes if stage['start'] <= o['finish'] < stage['end']]
    counts = collections.Counter(o['status'] for o in observations)
    mix = collections.Counter(o['caseId'] for o in window)
    meta = {c['id']: c for c in metadata}
    source_mix = collections.Counter()
    for case_id, count in mix.items():
        source_mix[meta[case_id]['source']] += count
    latencies = [o['finish'] - o['start'] for o in successes]
    window_latencies = [o['finish'] - o['start'] for o in window]
    error_latencies = [o['finish'] - o['start'] for o in observations
                       if o['status'] in ('http_error', 'contract_error', 'transport_error', 'timeout')]
    elapsed = max(0, stage['end'] - stage['start'])
    return dict(started=len(observations), completed=sum(o['status'] not in ('pending', 'cancelled') for o in observations),
                **{status: counts[status] for status in ('success', 'http_error', 'contract_error', 'transport_error', 'timeout', 'cancelled', 'pending')},
                window_success=len(window), drain_success=len(successes) - len(window),
                throughput=len(window) / elapsed if elapsed else None, duration=elapsed,
                p50=percentile(latencies, .5), p95=percentile(latencies, .95), maximum=max(latencies, default=None),
                error_p50=percentile(error_latencies, .5), error_p95=percentile(error_latencies, .95),
                error_maximum=max(error_latencies, default=None),
                window_p95=percentile(window_latencies, .95), case_mix=dict(sorted(mix.items())),
                source_mix=dict(sorted(source_mix.items())),
                fields=sum(meta[k]['fields'] * n for k, n in mix.items()),
                characters=sum(meta[k]['characters'] * n for k, n in mix.items()),
                words=sum(meta[k]['words'] * n for k, n in mix.items()),
                error_rate=sum(o['status'] != 'success' for o in observations) / len(observations) if observations else None)


def mix_distance(left, right):
    a, b = sum(left.values()), sum(right.values())
    if not a or not b:
        return None
    return .5 * sum(abs(left.get(k, 0) / a - right.get(k, 0) / b) for k in left.keys() | right.keys())


def plateau(stages):
    load = [s for s in stages if s['phase'] == 'load']
    repeats = [s for s in stages if s['phase'] == 'confirmation']
    result = dict(status='not_reached', concurrency=None, candidate=None, pair_tv=None, confirmation_tv=None)
    def degraded(metrics):
        return bool(metrics['error_rate'] or metrics['cancelled'] or metrics['pending'])
    observed_degradation = any(degraded(s['metrics']) for s in load + repeats)
    result['degradation_observed'] = observed_degradation
    if len(load) < 2:
        return dict(result, status='observed_degradation' if observed_degradation else 'inconclusive_insufficient_samples')
    uncertain = 'observed_degradation' if observed_degradation else None
    for previous, current in zip(load, load[1:]):
        a, b = previous['metrics'], current['metrics']
        if current['concurrency'] != 2 * previous['concurrency'] or degraded(a) or degraded(b):
            continue
        if min(a['window_success'], b['window_success']) < 30:
            uncertain = uncertain or 'inconclusive_insufficient_samples'
            continue
        tv = mix_distance(a['case_mix'], b['case_mix'])
        if tv is None or tv > .1 + 1e-12:
            uncertain = 'inconclusive_different_mix'
            continue
        if b['throughput'] <= 1.1 * a['throughput'] and b['window_p95'] > a['window_p95']:
            result.update(candidate=current['concurrency'], pair_tv=tv)
            repeat = next((s for s in repeats if s['concurrency'] == current['concurrency']), None)
            if repeat is None:
                return dict(result, status='inconclusive_unconfirmed')
            c = repeat['metrics']
            if degraded(c):
                return dict(result, status='observed_degradation')
            if c['window_success'] < 30:
                return dict(result, status='inconclusive_insufficient_samples')
            tv = mix_distance(b['case_mix'], c['case_mix'])
            result['confirmation_tv'] = tv
            if tv is None or tv > .1 + 1e-12:
                return dict(result, status='inconclusive_different_mix')
            if not .9 * b['throughput'] <= c['throughput'] <= 1.1 * b['throughput']:
                return dict(result, status='inconclusive_repeat_noise')
            return dict(result, status='preliminary_plateau_observed', concurrency=current['concurrency'])
    return dict(result, status=uncertain or result['status'])


def _ready_child(pipe, port, deadline):
    while time.monotonic() < deadline:
        connection = http.client.HTTPConnection('127.0.0.1', port, timeout=min(.5, max(.001, deadline - time.monotonic())))
        try:
            connection.request('GET', '/health/ready', headers={'Connection': 'close'})
            response = connection.getresponse()
            body = response.read(4097)
            if response.status == 200 and json.loads(body) == {'status': 'ready'}:
                pipe.send(True)
                return
        except (ValueError, OSError, http.client.HTTPException):
            pass
        finally:
            connection.close()
        time.sleep(min(.1, max(0, deadline - time.monotonic())))
    pipe.send(False)


def wait_ready(port, deadline, guard):
    context = multiprocessing.get_context('spawn')
    parent, child = context.Pipe(duplex=False)
    process = context.Process(target=_ready_child, args=(child, port, deadline), daemon=True)
    process.start()
    child.close()
    try:
        while time.monotonic() < deadline:
            reason = guard()
            if reason:
                return reason
            if parent.poll(.01):
                try:
                    return None if parent.recv() else 'readiness_timeout'
                except EOFError:
                    return 'readiness_process_exited'
        return 'readiness_timeout'
    finally:
        if process.is_alive():
            process.terminate()
        process.join(.2)
        if process.is_alive():
            process.kill()
            process.join(.2)
        parent.close()
        if not process.is_alive():
            process.close()


def idle_stage(phase, duration, deadline, guard):
    start = time.monotonic()
    end = min(start + duration, deadline)
    reason = None
    while time.monotonic() < end:
        reason = guard()
        if reason:
            break
        time.sleep(min(.02, max(0, end - time.monotonic())))
    finish = time.monotonic()
    return dict(phase=phase, concurrency=0, start=start, end=min(end, finish), drain_end=finish,
                observations=[], max_inflight=0, drained=reason is None, stop_reason=reason)


def transition_seconds(stage, invoked, returned):
    return max(0., returned - invoked - (stage['end'] - stage['start']))


def campaign(cases, images, cpus, memory, budget, *, docker=None,
             collector_factory=telemetry.Collector, protocol=Protocol()):
    """Prepare stopped containers first; one timed engine at a time, always cleanup."""
    docker = docker or telemetry.Docker(uuid.uuid4().hex[:16])
    metadata = case_metadata(cases)
    receipt = dict(schemaVersion=1, config=dict(cpus=cpus, memory=memory, budget_seconds=budget,
                   protocol=asdict(protocol)), cases=metadata, order=[c['id'] for c in cases],
                   engines={}, incidents=[], cleanup={}, complete=False, elapsed=0., stop_reason=None)
    started = hard_end = None
    prepared = {}
    try:
        preflight_end = time.monotonic() + 180.
        receipt['preflight'] = docker.preflight(images, cpus, memory, preflight_end)
        for engine in ENGINES:
            image = receipt['preflight']['images'][engine]
            cid = docker.create(engine, image['id'], cpus, memory, preflight_end)
            entry = dict(container=cid, image=image, static_disk=None, post_disk={'paths': None, 'reason': 'not_run'},
                         stages=[], samples=[], stop_reason='not_run', cleanup=False, state=None)
            receipt['engines'][engine] = entry
            entry['static_disk'] = docker.static_inventory(cid, image['cache_paths'], preflight_end)
            prepared[engine] = cid
        started = time.monotonic()
        hard_end = started + budget
        measurement_end = hard_end - protocol.reserve
        receipt['start'] = started
        receipt['deadline'] = hard_end
        for engine in ENGINES:
            if any('start' in e and not e['cleanup'] for e in receipt['engines'].values()):
                receipt['stop_reason'] = 'cleanup_failed_no_next_engine'
                break
            if not stage_admissible(time.monotonic(), measurement_end, protocol.socket_timeout):
                receipt['stop_reason'] = 'global_budget_exhausted'
                break
            cid = prepared[engine]
            entry = receipt['engines'][engine]
            engine_start = time.monotonic()
            engine_end = min(engine_start + protocol.engine_seconds, hard_end)
            traffic_end = min(engine_end - protocol.engine_cleanup, measurement_end)
            entry.update(start=engine_start, deadline=engine_end, stop_reason=None)
            collector = None
            stopped = False
            try:
                port = docker.start(cid, cpus, memory, traffic_end)
                collector = collector_factory(cid, cpus)
                next_state_check = 0.

                def guard():
                    nonlocal next_state_check
                    if time.monotonic() >= traffic_end:
                        return 'engine_or_global_budget'
                    reason = collector.guard()
                    if reason:
                        return reason
                    if collector.samples:
                        sample = collector.samples[-1]
                        try:
                            quota, period = map(int, sample['cpu_max'].split())
                            if sample['memory_max'] != memory or not math.isclose(quota / period, cpus, rel_tol=1e-6):
                                return 'cgroup_limits_mismatch'
                        except (TypeError, ValueError, ZeroDivisionError):
                            return 'cgroup_limits_missing'
                    now = time.monotonic()
                    if now >= next_state_check:
                        try:
                            info = docker.verify(cid, min(traffic_end, now + .5))
                        except (RuntimeError, TimeoutError, ValueError):
                            return 'container_state_unavailable'
                        if not info['State']['Running']:
                            return 'container_exited'
                        next_state_check = now + 1.
                    return None

                readiness_start = time.monotonic()
                entry['stop_reason'] = wait_ready(port, min(traffic_end, readiness_start + protocol.readiness), guard)
                entry['readiness'] = dict(start=readiness_start, end=time.monotonic(), ready=entry['stop_reason'] is None)
                if entry['stop_reason']:
                    continue
                stage = idle_stage('idle', protocol.idle, traffic_end, guard)
                entry['stages'].append(stage)
                if stage['stop_reason']:
                    entry['stop_reason'] = stage['stop_reason']
                    continue
                drain_left = protocol.drain
                for phase, concurrency in [('warmup', 1), ('load', 1), ('load', 2), ('load', 4), ('load', 8), ('confirmation', 8)]:
                    if drain_left <= 0 or not stage_admissible(time.monotonic(), traffic_end, protocol.socket_timeout):
                        entry['stop_reason'] = 'stage_budget_exhausted'
                        break
                    if phase == 'confirmation':
                        classified = plateau([dict(s, metrics=stage_metrics(s, metadata)) for s in entry['stages']])
                        concurrency = classified['candidate'] or 8
                    invoked = time.monotonic()
                    stage = run_stage('127.0.0.1', port, cases, concurrency,
                                      protocol.warmup if phase == 'warmup' else protocol.window,
                                      traffic_end, socket_timeout=protocol.socket_timeout,
                                      drain_budget=drain_left, guard=guard)
                    stage['phase'] = phase
                    entry['stages'].append(stage)
                    stage['transition_seconds'] = transition_seconds(stage, invoked, time.monotonic())
                    drain_left -= stage['transition_seconds']
                    if not stage['drained']:
                        entry['stop_reason'] = stage['stop_reason'] or 'server_drain_unknown'
                        if stage['stop_reason'] == 'interrupted':
                            raise KeyboardInterrupt
                        break
                    if drain_left < 0:
                        entry['stop_reason'] = 'transition_budget_exhausted'
                        break
                if entry['stop_reason'] is None:
                    stage = idle_stage('recovery', protocol.recovery, traffic_end, guard)
                    entry['stages'].append(stage)
                    entry['stop_reason'] = stage['stop_reason']
            except KeyboardInterrupt:
                entry['stop_reason'] = 'interrupted'
                raise
            except (OSError, RuntimeError, ValueError, TimeoutError):
                entry['stop_reason'] = 'engine_operation_failed'
            finally:
                if collector:
                    collector.poll()
                    stopped = collector.stop(min(engine_end, hard_end))
                    entry['samples'] = collector.samples
                    entry['collector_stopped'] = stopped
                    if not stopped:
                        entry['stop_reason'] = entry['stop_reason'] or 'collector_shutdown_failed'
                if stopped and entry['stop_reason'] is None:
                    paths = [p['path'] for p in entry['static_disk']['paths']]
                    entry['post_disk'] = docker.post_inventory(cid, paths, min(traffic_end, engine_end - .5), collector_stopped=True)
                else:
                    entry['post_disk'] = dict(paths=None, reason='unsafe_or_collector_not_stopped')
                try:
                    info = docker.verify(cid, min(engine_end, hard_end))
                    entry['state'] = {key: info['State'].get(key) for key in ('Running', 'OOMKilled', 'ExitCode')}
                    entry['effective_limits'] = {key: info['HostConfig'].get(key) for key in ('NanoCpus', 'Memory', 'MemorySwap')}
                except (RuntimeError, TimeoutError, ValueError):
                    entry['state'] = {'reason': 'state_unavailable'}
                cleanup = docker.cleanup(min(engine_end, hard_end), only=cid)
                receipt['cleanup'].update(cleanup)
                entry['cleanup'] = cleanup.get(cid, False)
                entry['end'] = time.monotonic()
            if not entry['cleanup']:
                receipt['stop_reason'] = 'cleanup_failed_no_next_engine'
                break
    except KeyboardInterrupt:
        receipt['stop_reason'] = 'interrupted'
    except (OSError, RuntimeError, ValueError, TimeoutError):
        receipt['stop_reason'] = 'preparation_or_run_failed'
    finally:
        # A bounded emergency cleanup may exceed the budget; record it, never hide it.
        cleanup_end = hard_end if hard_end and hard_end > time.monotonic() + 1 else time.monotonic() + 3
        receipt['cleanup'].update(docker.cleanup(cleanup_end))
        for entry in receipt['engines'].values():
            entry['cleanup'] = receipt['cleanup'].get(entry['container'], False)
            executed = [(s['phase'], s['concurrency']) for s in entry['stages']]
            entry['coverage'] = dict(executed=executed, complete=all(item in executed for item in
                [('idle', 0), ('warmup', 1), ('load', 1), ('load', 2), ('load', 4), ('load', 8), ('recovery', 0)]) and
                any(s['phase'] == 'confirmation' for s in entry['stages']) and not entry['stop_reason'])
        receipt['elapsed'] = time.monotonic() - started if started else 0.
        if hard_end and time.monotonic() > hard_end:
            receipt['incidents'].append('deadline_overrun_cleanup')
        receipt['complete'] = (not receipt['stop_reason'] and not receipt['incidents'] and len(receipt['engines']) == 3 and
                               all(e['coverage']['complete'] and e['cleanup'] for e in receipt['engines'].values()))
    return receipt


def validate_receipt(receipt):
    require = evaluation.require
    require(receipt.get('schemaVersion') == 1, 'RECEIPT_VERSION')
    require(set(receipt) <= {'schemaVersion', 'config', 'cases', 'order', 'engines', 'incidents', 'cleanup',
                            'complete', 'elapsed', 'stop_reason', 'preflight', 'start', 'deadline', 'gold_sha256'}, 'RECEIPT_KEYS')
    ids = set()
    for case in receipt['cases']:
        require(set(case) == {'id', 'source', 'fields', 'characters', 'words'}, 'CASE_METADATA')
        require(isinstance(case['id'], str) and case['id'] not in ids, 'CASE_ID')
        ids.add(case['id'])
        require(all(type(case[k]) is int and case[k] >= 0 for k in ('fields', 'characters', 'words')), 'CASE_COUNTS')
    require(len(receipt['order']) == len(ids) and set(receipt['order']) == ids, 'ORDER')
    require(set(receipt['engines']) <= set(ENGINES), 'ENGINES')
    for engine in receipt['engines'].values():
        previous_end = -math.inf
        for stage in engine['stages']:
            require(stage['phase'] in ('idle', 'warmup', 'load', 'confirmation', 'recovery'), 'PHASE')
            require(stage['concurrency'] in (0, 1, 2, 4, 8), 'CONCURRENCY')
            require(previous_end <= stage['start'] <= stage['end'] <= stage['drain_end'], 'STAGE_TIMES')
            previous_end = stage['drain_end']
            seen = set()
            for o in stage['observations']:
                require(set(o) == {'index', 'caseId', 'start', 'finish', 'status', 'code'}, 'OBSERVATION_KEYS')
                require(o['index'] not in seen and o['caseId'] in ids, 'OBSERVATION_ID')
                seen.add(o['index'])
                require(stage['start'] <= o['start'] < stage['end'], 'SUBMISSION_TIME')
                require(o['status'] in ('success', 'http_error', 'contract_error', 'transport_error', 'timeout', 'cancelled', 'pending'), 'STATUS')
                require(o['finish'] is None and o['status'] == 'pending' or
                        o['finish'] is not None and o['start'] <= o['finish'] <= stage['drain_end'], 'OBSERVATION_TIMES')
                require(o['code'] is None or o['code'] in ('INVALID_RESPONSE', 'TRANSPORT_ERROR', 'SOCKET_TIMEOUT', 'BUDGET_OR_GUARD') or
                        re.fullmatch(r'HTTP_[1-5][0-9]{2}', o['code']), 'ERROR_CODE')
            require(stage['max_inflight'] <= stage['concurrency'], 'INFLIGHT')


def resource_summary(samples):
    fields = ('memory_current', 'memory_peak', 'anon', 'file', 'shmem', 'kernel', 'memory_swap_current',
              'cpu_cores', 'cpu_budget_percent', 'delta_nr_throttled', 'delta_throttled_usec', 'read_seconds', 'gap_seconds')
    return {key: max((s[key] for s in samples if s.get(key) is not None), default=None) for key in fields}


def render(receipt, output, *, reserved=False):
    """All derived metrics regenerated from sanitized observations; no Docker/gold."""
    validate_receipt(receipt)
    output = Path(output)
    if not reserved:
        output.mkdir(parents=True, exist_ok=False)
    elif not output.is_dir() or any(output.iterdir()):
        raise FileExistsError('OUTPUT_NOT_EMPTY')
    with (output / 'results.json').open('x', encoding='utf-8') as stream:
        json.dump(receipt, stream, ensure_ascii=False, sort_keys=True, indent=2, allow_nan=False)
        stream.write('\n')
    rows, sample_rows, summaries = [], [], {}
    for name in ENGINES:
        if name not in receipt['engines']:
            continue
        engine = receipt['engines'][name]
        stages = []
        for index, stage in enumerate(engine['stages']):
            metrics = stage_metrics(stage, receipt['cases'])
            stages.append(dict(stage, metrics=metrics))
            selected = [s for s in engine['samples'] if stage['start'] <= s['time'] < stage['end']]
            rows.append(dict(engine=name, stage=index, phase=stage['phase'], concurrency=stage['concurrency'],
                             max_inflight=stage['max_inflight'], drained=stage['drained'], stop_reason=stage['stop_reason'],
                             **metrics, **{'sampled_' + k: v for k, v in resource_summary(selected).items()}))
        for sample in engine['samples']:
            phase = next((s['phase'] for s in engine['stages'] if s['start'] <= sample['time'] < s['end']), 'readiness_transition_or_drain')
            sample_rows.append(dict(engine=name, phase=phase, **sample))
        loads = [s for s in stages if s['phase'] == 'load' and s['metrics']['throughput'] is not None]
        best = max(loads, key=lambda s: s['metrics']['throughput'], default=None)
        summaries[name] = dict(capacity=plateau(stages), best=best,
            max_clients=max((s['concurrency'] for s in loads if s['metrics']['started']), default=0),
            resources=resource_summary(engine['samples']))
    for filename, values in [('stages.csv', rows), ('samples.csv', sample_rows)]:
        keys = sorted({k for row in values for k in row}) or ['engine', 'phase']
        with (output / filename).open('x', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=keys)
            writer.writeheader()
            for row in values:
                writer.writerow({k: json.dumps(v, sort_keys=True, ensure_ascii=False) if isinstance(v, (dict, list)) else v for k, v in row.items()})

    def show(value):
        if value is None:
            return 'null'
        return format(value, '.6g') if isinstance(value, float) else str(value).replace('|', '\\|').replace('\n', ' ')

    report = ['# Container resource experiment', '',
              'Containerized pipelines, not isolated model consumption. All byte figures are bytes; latency is seconds.',
              'Protocol complete: ' + str(receipt['complete']) + '; stop: ' + str(receipt['stop_reason']) + '.',
              'Configuration: `' + json.dumps(receipt['config'], sort_keys=True) + '`.', '',
              '| engine | best observed req/s | p95 s (best window successes incl. drain) | max HTTP clients | capacity finding | RAM peak sampled | cgroup lifetime peak | anon sampled max | file sampled max | CPU cores sampled max | CPU budget % sampled max |',
              '|---|---:|---:|---:|---|---:|---:|---:|---:|---:|---:|']
    for name, summary in summaries.items():
        best = summary['best']['metrics'] if summary['best'] else {}
        resources = summary['resources']
        report.append('| ' + ' | '.join(map(show, [name, best.get('throughput'), best.get('p95'), summary['max_clients'],
            summary['capacity']['status'], resources['memory_current'], resources['memory_peak'], resources['anon'], resources['file'],
            resources['cpu_cores'], resources['cpu_budget_percent']])) + ' |')
    for name, summary in summaries.items():
        engine = receipt['engines'][name]
        report += ['', '## ' + name, '',
                   'Image: `' + str(engine['image']['id']) + '`; logical image bytes: ' + show(engine['image'].get('logical_bytes')) + '.',
                   'Stop: ' + str(engine['stop_reason']) + '; cleanup verified: ' + str(engine['cleanup']) + '.',
                   'Coverage: `' + json.dumps(engine['coverage'], sort_keys=True) + '`.',
                   'Capacity diagnostic: `' + json.dumps(summary['capacity'], sort_keys=True) + '`.', '',
                   '| phase | clients | started | success window / drain | errors / timeouts / cancelled / pending | req/s | p50 / p95 / max s | RAM sampled max | CPU cores sampled max |',
                   '|---|---:|---:|---|---|---:|---|---:|---:|']
        for row in [row for row in rows if row['engine'] == name]:
            errors = row['http_error'] + row['contract_error'] + row['transport_error']
            report.append('| ' + ' | '.join(map(show, [row['phase'], row['concurrency'], row['started'],
                str(row['window_success']) + ' / ' + str(row['drain_success']),
                ' / '.join(map(str, [errors, row['timeout'], row['cancelled'], row['pending']])), row['throughput'],
                ' / '.join(show(row[k]) for k in ('p50', 'p95', 'maximum')), row['sampled_memory_current'], row['sampled_cpu_cores']])) + ' |')
        report += ['', '### Disk (overlapping scopes; do not sum)', '', '| timing | path | status | logical bytes | allocated bytes |', '|---|---|---|---:|---:|']
        for timing in ('static_disk', 'post_disk'):
            inventory = engine.get(timing) or {'paths': None, 'reason': 'not_measured'}
            if inventory.get('paths') is None:
                report.append('| ' + timing + ' | null | ' + inventory.get('reason', 'unavailable') + ' | null | null |')
            for item in inventory.get('paths') or []:
                report.append('| ' + ' | '.join(map(show, [timing, item['path'], item['status'], item.get('logical_bytes'), item.get('allocated_bytes')])) + ' |')
        report.append('Writable-layer bytes after traffic: ' + show(engine['post_disk'].get('writable_bytes')) + '.')
    report += ['', '## Mix and interpretation', '',
        'Per-case/source completion mix and total fields/characters/words are in stages.csv. Only in-window compliant successes enter throughput/mix; drain belongs to the submitting stage. Success latency includes drain; window_p95 is used for plateau.',
        'Plateau: >=30 in-window successes in both windows, no errors, <=10% gain on doubled clients and increasing window p95; confirmation within +/-10%, total variation <=0.10 for both comparisons. These are exploratory diagnostics, not statistical proof or an SLA.',
        'Different engines may complete different prefixes even with a common case order. HTTP clients are not simultaneous inference workers; Horizon serializes inference with a bounded queue.',
        'Memory file includes shmem: do not add them. Do not add RSS or file cache to memory.current. Per-process PID/PPid/RSS and missing-field reasons are in samples.csv; RSS is not summed.',
        'memory.peak is since container startup when available; per-phase maxima are sampled at about 1 Hz, not exact peaks. CPU includes collector and other container processes; cores = delta usage_usec / delta cgroup monotonic microseconds, quota% = cores / assigned CPUs * 100.',
        'Static exports can warm VM page cache. Post du runs only after collector shutdown; image/model/cache bytes overlap, shared layers are not exclusive recoverable disk, builder cache is out of scope.',
        'Short, warm, order/host-dependent exploratory run: no production capacity, minimum RAM, no-leak or long-term stability claim. Missing data is null, never invented zero. Errors are observed degradation, not proof of CPU saturation.',
        'Incidents: `' + json.dumps(receipt['incidents']) + '`.', '']
    with (output / 'report.md').open('x', encoding='utf-8') as stream:
        stream.write('\n'.join(report))


def case_metadata(cases):
    return [{'id': c['id'], 'source': c['source'], 'fields': len(c['fields']),
             'characters': sum(len(f['text']) for f in c['fields']),
             'words': sum(evaluation.words(f['text']) for f in c['fields'])} for c in cases]


def parse_args(argv=None):
    import argparse
    parser = argparse.ArgumentParser(description=__doc__, allow_abbrev=False)
    parser.add_argument('--gold', type=Path)
    parser.add_argument('--image', action='append', default=[], metavar='ENGINE=TAG_OR_ID',
                        help='Required per engine. Operator must verify source provenance before reuse.')
    parser.add_argument('--cpus', type=float, default=2.)
    parser.add_argument('--memory', default='4g')
    parser.add_argument('--budget-seconds', type=float, default=300.)
    parser.add_argument('--output', type=Path, required=True, help='New directory only; never overwrite')
    parser.add_argument('--rerender', type=Path, help='Offline receipt -> new bundle, without Docker/gold')
    args = parser.parse_args(argv)
    match = re.fullmatch(r'([1-9][0-9]*)([kmg]?)', args.memory.lower())
    if not match or not math.isfinite(args.cpus) or not 0 < args.cpus <= 256 or not 15 < args.budget_seconds <= 300:
        parser.error('Require positive finite CPU, integer memory [k/m/g], and 15 < budget <= 300 seconds')
    args.memory = int(match[1]) * 1024 ** ('', 'k', 'm', 'g').index(match[2])
    args.images = {}
    for value in args.image:
        engine, separator, image = value.partition('=')
        if not separator or engine not in ENGINES or engine in args.images or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]*', image):
            parser.error('Each engine needs exactly one valid image reference')
        args.images[engine] = image
    if args.rerender:
        if args.gold or args.image:
            parser.error('--rerender cannot be combined with --gold or --image')
    elif not args.gold or set(args.images) != set(ENGINES):
        parser.error('--gold and --image for rizzo, horizon and presidio are required')
    return args


def main(argv=None):
    import shutil
    import signal
    args = parse_args(argv)
    if args.rerender:
        receipt = json.loads(args.rerender.read_text(encoding='utf-8'), object_pairs_hook=evaluation.unique_object)
        render(receipt, args.output)
        return 0
    # Validate inputs and reserve output before any remote side effect.
    cases = load_gold(args.gold)
    args.output.mkdir(parents=True, exist_ok=False)
    if shutil.disk_usage(args.output).free < 100 * 1024**2:
        raise ValueError('OUTPUT_DISK_HEADROOM')
    old = {}
    def interrupt(signum, frame):
        # One interrupt initiates cleanup; subsequent signals cannot abort it halfway.
        for sig in (signal.SIGINT, signal.SIGTERM):
            signal.signal(sig, signal.SIG_IGN)
        raise KeyboardInterrupt
    for sig in (signal.SIGINT, signal.SIGTERM):
        old[sig] = signal.signal(sig, interrupt)
    try:
        receipt = campaign(cases, args.images, args.cpus, args.memory, args.budget_seconds)
        receipt['gold_sha256'] = hashlib.sha256(args.gold.read_bytes()).hexdigest()
        render(receipt, args.output, reserved=True)
        print('complete' if receipt['complete'] else 'partial; inspect results.json for sanitized stop reasons')
        return 0 if receipt['complete'] else 2
    finally:
        for sig, handler in old.items():
            signal.signal(sig, handler)


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (OSError, ValueError, KeyError, TypeError):
        # Never expose gold, raw HTTP bodies, Docker stderr, or credentials.
        print('Invalid input/output or receipt; no existing results overwritten', file=__import__('sys').stderr)
        raise SystemExit(2)
