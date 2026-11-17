#!/usr/bin/env python3
"""Bounded, sequential Docker resource experiment; stdlib only, explicit opt-in."""
import collections
import http.client
import math
import multiprocessing
import queue
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
CLIENT_START_SLACK = .1
MAX_FIXED_RATE_ARRIVALS = 100_000
OPEN_STOP_REASONS = {
    None, 'not_run', 'partial', 'interrupted', 'preparation_or_run_failed',
    'global_budget', 'memory_guard', 'oom_guard', 'telemetry_required_missing',
    'telemetry_lost', 'collector_invalid_frame', 'collector_frame_too_large', 'collector_exited',
    'cgroup_limits_mismatch', 'cgroup_limits_missing',
    'container_state_unavailable', 'container_exited', 'readiness_timeout',
    'readiness_process_exited', 'server_drain_unknown', 'drain_deadline_exhausted',
    'load_process_start_failed', 'load_process_exited', 'stage_budget_exhausted',
    'stabilization_failed',
}
OPEN_OBSERVATION_CODES = {
    None, 'SOCKET_TIMEOUT', 'INVALID_RESPONSE', 'TRANSPORT_ERROR',
    'CLIENT_STOPPED', 'CLIENT_ACCOUNTING_UNKNOWN', 'BUDGET_OR_GUARD',
    'CLIENT_LATE', 'CLIENT_DRAIN', 'CLIENT_CAPACITY',
}


def ordered_cases(cases):
    return sorted(cases, key=lambda c: hashlib.sha256(c['id'].encode()).hexdigest())


def load_gold_bytes(data):
    gold = json.loads(data.decode('utf-8'), object_pairs_hook=evaluation.unique_object)
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


def load_gold(path):
    return load_gold_bytes(Path(path).read_bytes())


def payload(case):
    return evaluation.payload_for(case, 'detection')


def fixed_rate_schedule(*, start, submission_end, rate):
    if not math.isfinite(rate) or rate <= 0:
        raise ValueError('RATE')
    if not math.isfinite(start) or not math.isfinite(submission_end) or submission_end < start:
        raise ValueError('WINDOW')
    count = max(0, math.ceil((submission_end - start) * rate))
    if count > MAX_FIXED_RATE_ARRIVALS:
        raise ValueError('ARRIVALS')
    return [(index, start + index / rate) for index in range(count)
            if start + index / rate < submission_end]


def fixed_rate_non_admission(*, now, submission_end, drain_deadline, timeout,
                             active, max_inflight, stopped):
    if stopped:
        return 'stopped_before_submit'
    if now >= submission_end:
        return 'late_arrival'
    if drain_deadline - now < timeout:
        return 'insufficient_drain'
    if active >= max_inflight:
        return 'client_capacity_exhausted'
    return None


NON_ADMISSION_CODES = {
    'stopped_before_submit': 'CLIENT_STOPPED',
    'late_arrival': 'CLIENT_LATE',
    'insufficient_drain': 'CLIENT_DRAIN',
    'client_capacity_exhausted': 'CLIENT_CAPACITY',
}


def _fixed_rate_child(pipe, host, port, cases, rate, timeout, max_inflight):
    """Dispatch absolute-time arrivals; each submitted request owns a connection."""
    state_lock = threading.Lock()
    event_queue = queue.SimpleQueue()
    writer_sentinel = object()
    stopped = threading.Event()
    stop_ack_sent = False
    active = 0
    workers = []

    def writer():
        while True:
            event = event_queue.get()
            if event is writer_sentinel:
                return
            pipe.send(event)

    writer_thread = threading.Thread(target=writer, daemon=True)
    writer_thread.start()

    def emit(event):
        event_queue.put(event)

    def receive_stop(wait=0.):
        nonlocal stop_ack_sent
        if pipe.poll(wait):
            message = pipe.recv()
            if message == ('stop',):
                stopped.set()
                if not stop_ack_sent:
                    stop_ack_sent = True
                    emit(('stop_ack', time.monotonic()))
        return stopped.is_set()

    emit(('ready',))
    start, submission_end, drain_deadline = pipe.recv()

    def request(index, case):
        nonlocal active
        now = time.monotonic()
        reason = fixed_rate_non_admission(
            now=now, submission_end=submission_end, drain_deadline=drain_deadline,
            timeout=timeout, active=0, max_inflight=1, stopped=stopped.is_set())
        if reason:
            emit(('not_admitted', index, now, reason, NON_ADMISSION_CODES[reason]))
            with state_lock:
                active -= 1
            return
        emit(('submit', index, now))
        connection = http.client.HTTPConnection(host, port, timeout=timeout)
        status, code = 'success', None
        try:
            connection.request('POST', '/v1/analyze', body=json.dumps(payload(case)).encode(),
                               headers={'Content-Type': 'application/json', 'Connection': 'close'})
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
        except ValueError:
            status, code = 'contract_error', 'INVALID_RESPONSE'
        except (OSError, http.client.HTTPException):
            status, code = 'transport_error', 'TRANSPORT_ERROR'
        finally:
            connection.close()
            with state_lock:
                active -= 1
                emit(('finish', index, time.monotonic(), status, code))

    for index, scheduled_at in fixed_rate_schedule(start=start, submission_end=submission_end, rate=rate):
        while True:
            if receive_stop(0.):
                break
            remaining = scheduled_at - time.monotonic()
            if remaining <= 0:
                break
            if receive_stop(min(.01, remaining)):
                break
        if stopped.is_set() or receive_stop(0.):
            break
        case = cases[index % len(cases)]
        now = time.monotonic()
        emit(('offer', index, case['id'], scheduled_at, now))
        with state_lock:
            reason = fixed_rate_non_admission(
                now=now, submission_end=submission_end, drain_deadline=drain_deadline,
                timeout=timeout, active=active, max_inflight=max_inflight,
                stopped=stopped.is_set())
            if reason is None:
                active += 1
        if reason:
            emit(('not_admitted', index, now, reason, NON_ADMISSION_CODES[reason]))
            continue
        worker = threading.Thread(target=request, args=(index, case), daemon=True)
        workers.append(worker)
        worker.start()

    for worker in workers:
        worker.join(max(0., drain_deadline - time.monotonic()))
    emit(('done', all(not worker.is_alive() for worker in workers)))
    event_queue.put(writer_sentinel)
    writer_thread.join(max(0., drain_deadline - time.monotonic()))
    pipe.close()


def run_fixed_rate_stage(host, port, cases, *, rate, duration, deadline, socket_timeout=5.,
                         drain_budget=5., max_client_inflight=64, guard=lambda: None):
    """Run one bounded fixed-rate window and retain its drain separately."""
    if not math.isfinite(duration) or duration <= 0:
        raise ValueError('DURATION')
    if not math.isfinite(socket_timeout) or socket_timeout <= 0:
        raise ValueError('SOCKET_TIMEOUT')
    if (not math.isfinite(drain_budget)
            or drain_budget < socket_timeout + CLIENT_START_SLACK):
        raise ValueError('DRAIN')
    if not isinstance(max_client_inflight, int) or max_client_inflight <= 0:
        raise ValueError('MAX_CLIENT_INFLIGHT')
    fixed_rate_schedule(start=0., submission_end=duration, rate=rate)

    context = multiprocessing.get_context('spawn')
    parent, child = context.Pipe()
    process = context.Process(target=_fixed_rate_child,
                              args=(child, host, port, cases, rate, socket_timeout,
                                    max_client_inflight), daemon=True)
    started = time.monotonic()
    start = submission_end = drain_deadline = started
    stage = dict(phase='measurement', offeredRate=rate, start=started,
                 submissionEnd=started, drainDeadline=started, drainEnd=started,
                 maxClientInflight=max_client_inflight, observations=[], maxInflight=0,
                 drained=False, accountingComplete=False, stopRequestedAt=None,
                 stopAcknowledgedAt=None, stop_reason=None)
    records = {}
    inflight = 0
    max_inflight_observed = 0
    done = False

    def apply_event(event):
        nonlocal inflight, max_inflight_observed, done
        kind = event[0]
        if kind == 'offer':
            _, index, case_id, scheduled_at, offered_at = event
            records[index] = dict(index=index, caseId=case_id, scheduledAt=scheduled_at,
                                  offeredAt=offered_at, submittedAt=None, finish=None,
                                  status='pending', code=None)
        elif kind == 'submit':
            _, index, submitted_at = event
            records[index]['submittedAt'] = submitted_at
            inflight += 1
            max_inflight_observed = max(max_inflight_observed, inflight)
            stage['maxInflight'] = max_inflight_observed
        elif kind == 'not_admitted':
            _, index, timestamp, status, code = event
            records[index].update(finish=timestamp, status=status, code=code)
        elif kind == 'finish':
            _, index, timestamp, status, code = event
            records[index].update(finish=timestamp, status=status, code=code)
            inflight -= 1
            if status in ('timeout', 'transport_error') and stage['stop_reason'] is None:
                stage['stop_reason'] = 'server_drain_unknown'
        elif kind == 'stop_ack':
            stage['stopAcknowledgedAt'] = event[1]
        elif kind == 'done':
            done = event[1]
            stage['accountingComplete'] = done
            if not done and stage['stop_reason'] is None:
                stage['stop_reason'] = 'drain_deadline_exhausted'

    def finalize_records(timestamp):
        for record in records.values():
            if record['status'] != 'pending':
                continue
            if record['submittedAt'] is None:
                if stage['accountingComplete']:
                    record.update(finish=timestamp, status='stopped_before_submit',
                                  code='CLIENT_STOPPED')
                else:
                    record.update(finish=timestamp, status='accounting_unknown',
                                  code='CLIENT_ACCOUNTING_UNKNOWN')
            else:
                record.update(finish=timestamp, status='cancelled', code='BUDGET_OR_GUARD')
        stage['observations'] = [records[index] for index in sorted(records)]

    stop_sent = False
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
        if not stage_admissible(start, deadline, duration + drain_budget):
            stage.update(start=start, submissionEnd=start, drainDeadline=start, drainEnd=start,
                         stop_reason='stage_budget_exhausted')
            return stage
        submission_end = start + duration
        drain_deadline = submission_end + drain_budget
        stage.update(start=start, submissionEnd=submission_end, drainDeadline=drain_deadline)
        parent.send((start, submission_end, drain_deadline))

        while True:
            now = time.monotonic()
            reason = guard()
            if reason and stage['stop_reason'] is None:
                stage['stop_reason'] = reason
                stage['stopRequestedAt'] = now
                parent.send(('stop',))
                stop_sent = True
            if now >= drain_deadline:
                if stage['stop_reason'] is None:
                    stage['stop_reason'] = 'drain_deadline_exhausted'
                break
            if not parent.poll(.01):
                if not process.is_alive():
                    stage['stop_reason'] = 'load_process_exited'
                    break
                continue
            try:
                event = parent.recv()
            except EOFError:
                stage['stop_reason'] = 'load_process_exited'
                break
            apply_event(event)
            if stage['stop_reason'] == 'server_drain_unknown' and not stop_sent:
                stage['stopRequestedAt'] = time.monotonic()
                parent.send(('stop',))
                stop_sent = True
            if event[0] == 'done':
                break
        stage['drainEnd'] = time.monotonic()
        stage['drained'] = done and stage['stop_reason'] is None
        return stage
    except KeyboardInterrupt:
        stage['stop_reason'] = 'interrupted'
        return stage
    finally:
        if process.is_alive():
            process.terminate()
        process.join(.2)
        if process.is_alive():
            process.kill()
            process.join(.2)
        until = time.monotonic() + .1
        while time.monotonic() < until and parent.poll(0):
            try:
                apply_event(parent.recv())
            except (EOFError, OSError):
                break
        now = time.monotonic()
        stage['drainEnd'] = now
        finalize_records(now)
        parent.close()
        if not process.is_alive():
            process.close()


def fixed_rate_metrics(stage, metadata):
    observations = stage['observations']
    submitted = [item for item in observations if item['submittedAt'] is not None]
    completed = [item for item in submitted if item['status'] not in ('pending', 'cancelled')]
    successes = [item for item in completed if item['status'] == 'success']
    window_completed = [item for item in completed if item['finish'] < stage['submissionEnd']]
    window_successes = [item for item in successes if item['finish'] < stage['submissionEnd']]
    counts = collections.Counter(item['status'] for item in observations)
    by_id = {item['id']: item for item in metadata}
    duration = max(0., stage['submissionEnd'] - stage['start'])
    latencies = [item['finish'] - item['submittedAt'] for item in successes]
    return dict(
        offered=len(observations), submitted=len(submitted), completed=len(completed),
        success=counts['success'], http_error=counts['http_error'],
        contract_error=counts['contract_error'], transport_error=counts['transport_error'],
        timeout=counts['timeout'], client_capacity_exhausted=counts['client_capacity_exhausted'],
        late_arrival=counts['late_arrival'], insufficient_drain=counts['insufficient_drain'],
        stopped_before_submit=counts['stopped_before_submit'],
        accounting_unknown=counts['accounting_unknown'],
        cancelled=counts['cancelled'], pending=counts['pending'],
        in_window_completed=len(window_completed),
        drain_completed=len(completed) - len(window_completed),
        requests_per_second=len(window_successes) / duration if duration else None,
        fields_per_second=(sum(by_id[item['caseId']]['fields'] for item in window_successes) / duration
                           if duration else None),
        p50=percentile(latencies, .5), p90=percentile(latencies, .9),
        p95=percentile(latencies, .95), p99=percentile(latencies, .99),
        maximum=max(latencies, default=None),
    )


def fixed_rate_stage_success(stage):
    if (not stage or stage['stop_reason'] is not None or not stage['drained']
            or not stage['accountingComplete']):
        return False
    expected = len(fixed_rate_schedule(start=stage['start'],
                                       submission_end=stage['submissionEnd'],
                                       rate=stage['offeredRate']))
    return (len(stage['observations']) == expected
            and all(item['status'] == 'success' and item['code'] is None
                    for item in stage['observations']))


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


def memory_limit_matches(requested, observed, page_size=4096):
    return (isinstance(requested, int) and isinstance(observed, int)
            and 0 <= requested - observed < page_size)


def effective_cgroup_limits(samples, cpus, memory):
    for sample in samples:
        try:
            quota, period = map(int, sample['cpu_max'].split())
            if (memory_limit_matches(memory, sample['memory_max']) and period > 0
                    and math.isclose(quota / period, cpus, rel_tol=1e-6)):
                return True
        except (AttributeError, KeyError, TypeError, ValueError, ZeroDivisionError):
            pass
    return False


def open_loop_campaign(cases, *, engine, image, cpus, memory, rate,
                       measurement_seconds, drain_seconds, socket_timeout,
                       max_client_inflight, budget_seconds, docker=None,
                       collector_factory=telemetry.Collector, readiness_seconds=20.,
                       cleanup_reserve=3., stabilization_seconds=0.):
    """Run one Candidate-A fixed-rate stage with owned Docker lifecycle."""
    if engine not in ('horizon', 'rizzo') or cpus != 2. or memory != 4_000_000_000:
        raise ValueError('OPEN_LOOP_ENVELOPE')
    docker = docker or telemetry.Docker(uuid.uuid4().hex[:16])
    metadata = case_metadata(cases)
    receipt: dict = dict(
        schemaVersion=2, benchmark='fixed_rate_open_loop',
        config=dict(engine=engine, candidate='A', cpus=cpus, memory=memory, rate=rate,
                    stabilization_seconds=stabilization_seconds,
                    measurement_seconds=measurement_seconds, drain_seconds=drain_seconds,
                    socket_timeout_seconds=socket_timeout,
                    max_client_inflight=max_client_inflight, budget_seconds=budget_seconds),
        cases=metadata, order=[case['id'] for case in cases], preflight=None, engine=None,
        incidents=[], cleanup={}, complete=False, elapsed=0., stop_reason=None,
        start=None, deadline=None)
    prepared = collector = None
    started = time.monotonic()
    hard_end = started + budget_seconds
    traffic_end = hard_end - cleanup_reserve
    receipt.update(start=started, deadline=hard_end)
    entry: dict = dict(name=engine, candidate='A', container=None, image=None, static_disk=None,
                 post_disk={'paths': None, 'reason': 'not_run'}, readiness=None,
                 stabilization=None, stage=None,
                 samples=[], collector_stopped=False, state=None, effective_limits=None,
                 cleanup=False, stop_reason='not_run')
    receipt['engine'] = entry
    try:
        receipt['preflight'] = docker.preflight({engine: image}, cpus, memory, traffic_end)
        resolved = receipt['preflight']['images'][engine]
        entry['image'] = resolved
        prepared = docker.create(engine, resolved['id'], cpus, memory, traffic_end)
        entry['container'] = prepared
        entry['static_disk'] = docker.static_inventory(prepared, resolved['cache_paths'], traffic_end)
        port = docker.start(prepared, cpus, memory, traffic_end)
        collector = collector_factory(prepared, cpus)
        next_state_check = 0.

        def guard():
            nonlocal next_state_check
            now = time.monotonic()
            if now >= traffic_end:
                return 'global_budget'
            reason = collector.guard()
            if reason:
                return reason
            if collector.samples:
                sample = collector.samples[-1]
                try:
                    quota, period = map(int, sample['cpu_max'].split())
                    if (not memory_limit_matches(memory, sample['memory_max'])
                            or not math.isclose(quota / period, cpus, rel_tol=1e-6)):
                        return 'cgroup_limits_mismatch'
                except (AttributeError, KeyError, TypeError, ValueError, ZeroDivisionError):
                    return 'cgroup_limits_missing'
            if now >= next_state_check:
                try:
                    info = docker.verify(prepared, min(traffic_end, now + 2.))
                except (RuntimeError, TimeoutError, ValueError):
                    return 'container_state_unavailable'
                if not info['State']['Running']:
                    return 'container_exited'
                next_state_check = now + 1.
            return None

        readiness_start = time.monotonic()
        entry['stop_reason'] = wait_ready(
            port, min(traffic_end, readiness_start + readiness_seconds), guard)
        entry['readiness'] = dict(start=readiness_start, end=time.monotonic(),
                                  ready=entry['stop_reason'] is None)
        if entry['stop_reason'] is None:
            if stabilization_seconds > 0:
                entry['stabilization'] = run_fixed_rate_stage(
                    '127.0.0.1', port, cases, rate=rate, duration=stabilization_seconds,
                    deadline=traffic_end, socket_timeout=socket_timeout,
                    drain_budget=drain_seconds, max_client_inflight=max_client_inflight,
                    guard=guard)
                entry['stabilization']['phase'] = 'stabilization'
                entry['stop_reason'] = entry['stabilization']['stop_reason']
                if entry['stop_reason'] is None and not fixed_rate_stage_success(entry['stabilization']):
                    entry['stop_reason'] = 'stabilization_failed'
        if entry['stop_reason'] is None:
            entry['stage'] = run_fixed_rate_stage(
                '127.0.0.1', port, cases, rate=rate, duration=measurement_seconds,
                deadline=traffic_end, socket_timeout=socket_timeout,
                drain_budget=drain_seconds, max_client_inflight=max_client_inflight,
                guard=guard)
            entry['stop_reason'] = entry['stage']['stop_reason']
    except KeyboardInterrupt:
        entry['stop_reason'] = receipt['stop_reason'] = 'interrupted'
    except (OSError, RuntimeError, ValueError, TimeoutError, KeyError):
        entry['stop_reason'] = receipt['stop_reason'] = 'preparation_or_run_failed'
    finally:
        collector_stopped = False
        if collector:
            collector.poll()
            collector_stopped = collector.stop(min(hard_end, time.monotonic() + cleanup_reserve))
            entry['samples'] = collector.samples
        entry['collector_stopped'] = collector_stopped
        if collector_stopped and prepared:
            try:
                entry['post_disk'] = docker.post_inventory(
                    prepared, (entry['image'] or {}).get('cache_paths', []), hard_end,
                    collector_stopped=True)
            except (RuntimeError, TimeoutError, ValueError):
                entry['post_disk'] = {'paths': None, 'reason': 'post_inventory_failed'}
        if prepared:
            try:
                info = docker.verify(prepared, hard_end)
                entry['state'] = {key: info['State'].get(key)
                                  for key in ('Running', 'OOMKilled', 'ExitCode')}
                entry['effective_limits'] = {key: info['HostConfig'].get(key)
                                             for key in ('NanoCpus', 'Memory', 'MemorySwap')}
            except (RuntimeError, TimeoutError, ValueError):
                entry['state'] = {'reason': 'state_unavailable'}
        receipt['cleanup'].update(docker.cleanup(max(hard_end, time.monotonic() + 1.)))
        entry['cleanup'] = bool(prepared and receipt['cleanup'].get(prepared))
        stage = entry['stage']
        stabilization = entry['stabilization']
        receipt['elapsed'] = time.monotonic() - started
        limits_proven = effective_cgroup_limits(entry['samples'], cpus, memory)
        host_limits_proven = bool(entry['effective_limits']
            and entry['effective_limits'].get('NanoCpus') == round(cpus * 1e9)
            and entry['effective_limits'].get('Memory') == memory
            and entry['effective_limits'].get('MemorySwap') == memory)
        if not limits_proven:
            receipt['incidents'].append('CGROUP_LIMITS_UNPROVEN')
        if not host_limits_proven:
            receipt['incidents'].append('DOCKER_LIMITS_UNPROVEN')
        if time.monotonic() > hard_end:
            receipt['incidents'].append('HARD_DEADLINE_OVERRUN')
        receipt['complete'] = bool(
            stage and stage['drained'] and stage['accountingComplete']
            and (stabilization is None
                 or stabilization['drained'] and stabilization['accountingComplete'])
            and entry['stop_reason'] is None and collector_stopped and entry['cleanup']
            and entry['state'] and not entry['state'].get('OOMKilled')
            and limits_proven and host_limits_proven and not receipt['incidents']
            and receipt['elapsed'] <= budget_seconds)
        if not receipt['complete'] and receipt['stop_reason'] is None:
            receipt['stop_reason'] = entry['stop_reason'] or 'partial'
    return receipt


def validate_open_loop_receipt(receipt):
    require = evaluation.require
    def number(value):
        return not isinstance(value, bool) and isinstance(value, (int, float)) and math.isfinite(value)

    root_keys = {'schemaVersion', 'benchmark', 'config', 'cases', 'order', 'preflight',
                 'engine', 'incidents', 'cleanup', 'complete', 'elapsed', 'stop_reason',
                 'start', 'deadline', 'gold_sha256'}
    require(receipt.get('schemaVersion') == 2, 'OPEN_RECEIPT_VERSION')
    require(receipt.get('benchmark') == 'fixed_rate_open_loop', 'OPEN_BENCHMARK')
    require(set(receipt) <= root_keys and root_keys - {'gold_sha256'} <= set(receipt),
            'OPEN_RECEIPT_KEYS')
    require(all(number(receipt[key]) for key in ('elapsed', 'start', 'deadline'))
            and receipt['start'] <= receipt['deadline'] and receipt['elapsed'] >= 0,
            'OPEN_ROOT_TIMES')
    require(isinstance(receipt['complete'], bool)
            and receipt['stop_reason'] in OPEN_STOP_REASONS, 'OPEN_ROOT_STATE')
    if 'gold_sha256' in receipt:
        require(isinstance(receipt['gold_sha256'], str)
                and re.fullmatch(r'[0-9a-f]{64}', receipt['gold_sha256']), 'OPEN_GOLD_HASH')
    config = receipt['config']
    config_keys = {'engine', 'candidate', 'cpus', 'memory', 'rate',
                   'measurement_seconds', 'drain_seconds', 'socket_timeout_seconds',
                   'max_client_inflight', 'budget_seconds'}
    require(set(config) in (config_keys, config_keys | {'stabilization_seconds'}),
            'OPEN_CONFIG_KEYS')
    require(config.get('candidate') == 'A' and config.get('engine') in ('horizon', 'rizzo'),
            'OPEN_CONFIG_ENGINE')
    require(config.get('cpus') == 2. and config.get('memory') == 4_000_000_000,
            'OPEN_CONFIG_LIMITS')
    require(all(number(config.get(key)) and config[key] > 0 for key in
                ('rate', 'measurement_seconds', 'drain_seconds', 'socket_timeout_seconds',
                 'max_client_inflight', 'budget_seconds')), 'OPEN_CONFIG_NUMBERS')
    require(number(config.get('stabilization_seconds', 0))
            and config.get('stabilization_seconds', 0) >= 0, 'OPEN_STABILIZATION_CONFIG')
    ids = set()
    for case in receipt['cases']:
        require(set(case) == {'id', 'source', 'fields', 'characters', 'words'},
                'OPEN_CASE_METADATA')
        require(isinstance(case['id'], str) and case['id'] not in ids, 'OPEN_CASE_ID')
        require(isinstance(case['source'], str)
                and re.fullmatch(r'[a-z][a-z0-9_-]{0,63}', case['source'])
                and all(isinstance(case[key], int) and not isinstance(case[key], bool)
                        and case[key] >= 0 for key in ('fields', 'characters', 'words')),
                'OPEN_CASE_VALUES')
        ids.add(case['id'])
    require(len(receipt['order']) == len(ids) and set(receipt['order']) == ids,
            'OPEN_ORDER')
    engine = receipt['engine']
    engine_keys = {'name', 'candidate', 'container', 'image', 'static_disk', 'post_disk',
                   'readiness', 'stage', 'samples', 'collector_stopped', 'state',
                   'effective_limits', 'cleanup', 'stop_reason'}
    require(isinstance(engine, dict)
            and set(engine) in (engine_keys, engine_keys | {'stabilization'}), 'OPEN_ENGINE_KEYS')
    require(engine['name'] == config['engine'] and engine['candidate'] == 'A',
            'OPEN_ENGINE')
    require(engine['stop_reason'] in OPEN_STOP_REASONS, 'OPEN_ENGINE_STOP')
    require(isinstance(engine['cleanup'], bool) and isinstance(engine['collector_stopped'], bool),
            'OPEN_ENGINE_BOOLEANS')
    if engine['container'] is not None:
        require(isinstance(engine['container'], str)
                and re.fullmatch(r'[0-9a-f]{64}', engine['container']), 'OPEN_CONTAINER')
    image = engine['image']
    if image is not None:
        require(set(image) == {'id', 'architecture', 'logical_bytes', 'runtime',
                               'cache_paths', 'provenance'}, 'OPEN_IMAGE_KEYS')
        require(set(image['runtime']) == {'entrypoint', 'cmd'}, 'OPEN_RUNTIME_KEYS')
        require(isinstance(image['id'], str) and re.fullmatch(r'sha256:[0-9a-f]{64}', image['id'])
                and image['architecture'] in ('amd64', 'arm64')
                and isinstance(image['logical_bytes'], int) and image['logical_bytes'] >= 0
                and image['provenance'] == 'operator_verified_source_image', 'OPEN_IMAGE_VALUES')
        require(all(value is None or isinstance(value, (str, list))
                    and (isinstance(value, str) or all(isinstance(item, str) for item in value))
                    for value in image['runtime'].values()), 'OPEN_RUNTIME_VALUES')
        require(isinstance(image['cache_paths'], list)
                and all(isinstance(path, str) and path.startswith('/') for path in image['cache_paths']),
                'OPEN_CACHE_PATHS')
    preflight = receipt['preflight']
    if preflight is not None:
        require(set(preflight) == {'host', 'images'}, 'OPEN_PREFLIGHT_KEYS')
        require(set(preflight['host']) == {'NCPU', 'MemTotal', 'CgroupVersion',
                                           'Architecture', 'ServerVersion'}, 'OPEN_HOST_KEYS')
        require(set(preflight['images']) == {config['engine']}, 'OPEN_PREFLIGHT_IMAGES')
        require(preflight['images'][config['engine']] == image, 'OPEN_PREFLIGHT_IMAGE')
    if engine['static_disk'] is not None:
        require(set(engine['static_disk']) == {'paths', 'method', 'cache_warning'},
                'OPEN_STATIC_KEYS')
        for item in engine['static_disk']['paths']:
            require(set(item) == {'path', 'status', 'logical_bytes', 'allocated_bytes', 'reason'},
                    'OPEN_STATIC_PATH_KEYS')
    require(isinstance(engine['post_disk'], dict)
            and set(engine['post_disk']) in ({'paths', 'reason'},
                                             {'paths', 'writable_bytes', 'rootfs_bytes', 'method'}),
            'OPEN_POST_KEYS')
    if engine['post_disk'].get('paths') is not None:
        for item in engine['post_disk']['paths']:
            require(set(item) == {'path', 'status', 'allocated_bytes'}, 'OPEN_POST_PATH_KEYS')
    if engine['readiness'] is not None:
        require(set(engine['readiness']) == {'start', 'end', 'ready'}
                and isinstance(engine['readiness']['ready'], bool)
                and number(engine['readiness']['start']) and number(engine['readiness']['end'])
                and engine['readiness']['start'] <= engine['readiness']['end'], 'OPEN_READINESS')
    if engine['state'] is not None:
        require(set(engine['state']) in ({'Running', 'OOMKilled', 'ExitCode'}, {'reason'}),
                'OPEN_STATE_KEYS')
        if 'reason' in engine['state']:
            require(engine['state']['reason'] == 'state_unavailable', 'OPEN_STATE_REASON')
        else:
            require(isinstance(engine['state']['Running'], bool)
                    and isinstance(engine['state']['OOMKilled'], bool)
                    and isinstance(engine['state']['ExitCode'], int)
                    and not isinstance(engine['state']['ExitCode'], bool), 'OPEN_STATE_VALUES')
    if engine['effective_limits'] is not None:
        require(set(engine['effective_limits']) == {'NanoCpus', 'Memory', 'MemorySwap'},
                'OPEN_EFFECTIVE_LIMIT_KEYS')
        require(all(isinstance(value, int) and not isinstance(value, bool) and value >= 0
                    for value in engine['effective_limits'].values()), 'OPEN_EFFECTIVE_LIMIT_VALUES')

    sample_keys = {'time', 'cgroup_time', 'cpu_time', 'cpu_time_source', 'cpu_read_seconds',
                   'read_seconds', 'gap_seconds', 'missing', 'memory_current', 'memory_max',
                   'memory_peak', 'memory_swap_current', 'anon', 'file', 'shmem', 'kernel',
                   'oom', 'oom_kill', 'usage_usec', 'nr_throttled', 'throttled_usec',
                   'cpu_max', 'processes', 'cpu_cores', 'cpu_budget_percent',
                   'delta_nr_throttled', 'delta_throttled_usec'}
    for sample in engine['samples']:
        require(set(sample) == sample_keys, 'OPEN_SAMPLE_KEYS')
        require(all(number(sample[key]) for key in ('time', 'cgroup_time', 'cpu_time',
                                                    'read_seconds')), 'OPEN_SAMPLE_TIMES')
        require(isinstance(sample['missing'], dict)
                and all(key in sample_keys and value == 'absent_unreadable_or_unlimited'
                        or key == 'cpu_delta' and value == 'counter_reset_missing_or_clock'
                        for key, value in sample['missing'].items()), 'OPEN_SAMPLE_MISSING')
        require(isinstance(sample['processes'], list), 'OPEN_SAMPLE_PROCESSES')
        for process in sample['processes']:
            require(set(process) == {'pid', 'ppid', 'rss', 'name'}
                    and isinstance(process['name'], str)
                    and all(value is None or isinstance(value, int) and not isinstance(value, bool)
                            for value in (process['pid'], process['ppid'], process['rss'])),
                    'OPEN_PROCESS_KEYS')
        require(isinstance(sample['cpu_time_source'], str)
                and sample['cpu_time_source'] in ('cpu_stat_midpoint', 'frame_begin_legacy'),
                'OPEN_CPU_SOURCE')
        optional_numbers = sample_keys - {'cpu_time_source', 'missing', 'cpu_max', 'processes'}
        require(all(sample[key] is None or number(sample[key]) for key in optional_numbers),
                'OPEN_SAMPLE_NUMBERS')
        require(sample['cpu_max'] is None or isinstance(sample['cpu_max'], str)
                and re.fullmatch(r'(?:max|[0-9]+) [1-9][0-9]*', sample['cpu_max']),
                'OPEN_CPU_MAX')
    require(isinstance(receipt['incidents'], list)
            and all(isinstance(value, str) and re.fullmatch(r'[A-Z][A-Z0-9_]*', value)
                    for value in receipt['incidents']), 'OPEN_INCIDENTS')
    require(isinstance(receipt['cleanup'], dict)
            and all(isinstance(key, str) and isinstance(value, bool)
                    for key, value in receipt['cleanup'].items()), 'OPEN_CLEANUP')
    def validate_fixed_rate_stage(stage, expected_phase):
        if stage is None:
            return
        stage_keys = {'phase', 'offeredRate', 'start', 'submissionEnd', 'drainDeadline',
                      'drainEnd', 'maxClientInflight', 'observations', 'maxInflight',
                      'drained', 'accountingComplete', 'stopRequestedAt',
                      'stopAcknowledgedAt', 'stop_reason'}
        require(set(stage) == stage_keys and stage['phase'] == expected_phase,
                'OPEN_STAGE_KEYS')
        require(stage['stop_reason'] in OPEN_STOP_REASONS, 'OPEN_STAGE_STOP')
        require(all(number(stage[key]) for key in
                    ('offeredRate', 'start', 'submissionEnd', 'drainDeadline', 'drainEnd'))
                and all(isinstance(stage[key], int) and not isinstance(stage[key], bool)
                        and stage[key] >= 0 for key in ('maxClientInflight', 'maxInflight')),
                'OPEN_STAGE_VALUES')
        require(stage['start'] <= stage['submissionEnd'] <= stage['drainDeadline']
                and stage['start'] <= stage['drainEnd'], 'OPEN_STAGE_TIMES')
        require(stage['offeredRate'] == config['rate']
                and stage['maxClientInflight'] == config['max_client_inflight']
                and stage['drainDeadline'] <= stage['submissionEnd'] + config['drain_seconds'] + 1e-6,
                'OPEN_STAGE_CONFIG')
        require(stage['maxInflight'] <= stage['maxClientInflight'], 'OPEN_INFLIGHT')
        seen = set()
        terminal = {'success', 'http_error', 'contract_error', 'transport_error', 'timeout',
                    'client_capacity_exhausted', 'late_arrival', 'insufficient_drain',
                    'stopped_before_submit', 'accounting_unknown', 'cancelled'}
        for observation in stage['observations']:
            require(set(observation) == {'index', 'caseId', 'scheduledAt', 'offeredAt',
                                        'submittedAt', 'finish', 'status', 'code'},
                    'OPEN_OBSERVATION_KEYS')
            require(isinstance(observation['index'], int)
                    and not isinstance(observation['index'], bool) and observation['index'] >= 0
                    and observation['index'] not in seen and observation['caseId'] in ids,
                    'OPEN_OBSERVATION_ID')
            seen.add(observation['index'])
            require(observation['status'] in terminal, 'OPEN_STATUS')
            require(observation['code'] in OPEN_OBSERVATION_CODES
                    or (observation['status'] == 'http_error'
                        and isinstance(observation['code'], str)
                        and re.fullmatch(r'HTTP_[1-5][0-9]{2}', observation['code'])),
                    'OPEN_OBSERVATION_CODE')
            require(all(value is None or number(value) for value in
                        (observation['scheduledAt'], observation['offeredAt'],
                         observation['submittedAt'], observation['finish'])),
                    'OPEN_OBSERVATION_TIMES')
            require(stage['start'] <= observation['scheduledAt'] < stage['submissionEnd']
                    and observation['offeredAt'] >= observation['scheduledAt'],
                    'OPEN_OFFER_TIMES')
            if observation['submittedAt'] is not None:
                require(observation['offeredAt'] <= observation['submittedAt'],
                        'OPEN_SUBMIT_TIME')
            require(observation['finish'] is not None, 'OPEN_TERMINAL_FINISH')
    stage = engine.get('stage')
    stabilization = engine.get('stabilization')
    validate_fixed_rate_stage(stabilization, 'stabilization')
    validate_fixed_rate_stage(stage, 'measurement')
    require(config.get('stabilization_seconds', 0) > 0 or stabilization is None,
            'OPEN_STABILIZATION_UNEXPECTED')
    require(not receipt['complete'] or config.get('stabilization_seconds', 0) == 0
            or stabilization is not None, 'OPEN_STABILIZATION_REQUIRED')
    if stabilization is not None:
        require(math.isclose(stabilization['submissionEnd'] - stabilization['start'],
                             config['stabilization_seconds'], rel_tol=1e-9),
                'OPEN_STABILIZATION_DURATION')
    if stage is not None:
        require(math.isclose(stage['submissionEnd'] - stage['start'],
                             config['measurement_seconds'], rel_tol=1e-9),
                'OPEN_MEASUREMENT_DURATION')
    if stabilization is not None and stage is not None:
        require(stabilization['drainEnd'] <= stage['start'], 'OPEN_PHASE_OVERLAP')
    serialized = json.dumps(receipt, ensure_ascii=False, sort_keys=True)
    for forbidden in ('"text"', '"findings"', '"body"', 'REQUEST_SENTINEL_',
                      'RESPONSE_SENTINEL_'):
        require(forbidden not in serialized, 'OPEN_PRIVACY')
    if receipt['complete']:
        require(stage is not None and stage['drained'] and stage['accountingComplete']
                and (stabilization is None
                     or fixed_rate_stage_success(stabilization))
                and engine['cleanup'] and engine['collector_stopped']
                and engine['stop_reason'] is None and receipt['stop_reason'] is None
                and not receipt['incidents'] and engine['state'] is not None
                and not engine['state'].get('OOMKilled')
                and engine['effective_limits'] == {'NanoCpus': 2_000_000_000,
                                                   'Memory': 4_000_000_000,
                                                   'MemorySwap': 4_000_000_000}
                and effective_cgroup_limits(engine['samples'], 2., 4_000_000_000)
                and receipt['elapsed'] <= config['budget_seconds'], 'OPEN_COMPLETE_INCONSISTENT')


def render_open_loop(receipt, output, *, reserved=False):
    validate_open_loop_receipt(receipt)
    output = Path(output)
    if not reserved:
        output.mkdir(parents=True, exist_ok=False)
    elif not output.is_dir() or any(output.iterdir()):
        raise FileExistsError('OUTPUT_NOT_EMPTY')
    with (output / 'results.json').open('x', encoding='utf-8') as stream:
        json.dump(receipt, stream, ensure_ascii=False, sort_keys=True, indent=2,
                  allow_nan=False)
        stream.write('\n')
    engine = receipt['engine']
    stage = engine.get('stage')
    metrics = fixed_rate_metrics(stage, receipt['cases']) if stage else {}
    def stage_row(item, phase):
        values = dict(engine=engine['name'], candidate=engine['candidate'], phase=phase,
                      rate=receipt['config']['rate'], drained=item['drained'] if item else False,
                      accounting_complete=item['accountingComplete'] if item else False,
                      stop_reason=(item or {}).get('stop_reason', engine['stop_reason']),
                      **(fixed_rate_metrics(item, receipt['cases']) if item else {}),
                      **{'sampled_' + key: value
                         for key, value in (phase_resource_summary(
                             engine['samples'], item['start'], item['submissionEnd'])
                             if item else resource_summary([])).items()})
        return {key: "'" + value
                if isinstance(value, str) and value.startswith(('=', '+', '-', '@')) else value
                for key, value in values.items()}

    rows = []
    if engine.get('stabilization') is not None:
        rows.append(stage_row(engine['stabilization'], 'stabilization'))
    rows.append(stage_row(stage, 'measurement'))
    with (output / 'stages.csv').open('x', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=sorted({key for row in rows for key in row}))
        writer.writeheader()
        writer.writerows(rows)
    def csv_value(value):
        if isinstance(value, (dict, list)):
            return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'))
        if isinstance(value, str) and value.startswith(('=', '+', '-', '@')):
            return "'" + value
        return value

    sample_rows = [{key: csv_value(value) for key, value in dict(engine=engine['name'], **sample).items()}
                   for sample in engine['samples']]
    sample_keys = sorted({key for row in sample_rows for key in row}) or ['engine']
    with (output / 'samples.csv').open('x', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=sample_keys)
        writer.writeheader()
        writer.writerows(sample_rows)

    def show(value):
        if value is None:
            return 'null'
        return format(value, '.6g') if isinstance(value, float) else str(value)

    report = [
        '# Fixed-rate open-loop capacity stage', '',
        'Candidate A; single container; fixed offered rate; sanitized receipt.', '',
        'Engine: `' + engine['name'] + '`; complete: ' + str(receipt['complete'])
        + '; stop: ' + str(receipt['stop_reason']) + '.',
        'Envelope: 2 CPU and 4,000,000,000 bytes.',
        'Offered rate: ' + show(receipt['config']['rate']) + ' requests/s; stabilization: '
        + show(receipt['config'].get('stabilization_seconds', 0)) + ' s; measurement: '
        + show(receipt['config']['measurement_seconds']) + ' s.', '',
        '| offered | submitted | completed | success | capacity rejected | late | drain rejected | timeout | errors | p50 s | p90 s | p95 s | p99 s | req/s | fields/s |',
        '|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
        '| ' + ' | '.join(show(metrics.get(key)) for key in
            ('offered', 'submitted', 'completed', 'success', 'client_capacity_exhausted',
             'late_arrival', 'insufficient_drain', 'timeout', 'contract_error',
             'p50', 'p90', 'p95', 'p99', 'requests_per_second', 'fields_per_second')) + ' |', '',
        'Requests completed after the submission window are drain completions. '
        'This single stage is not yet a sustainable-capacity conclusion.', '',
        'Accounting complete: ' + str(stage['accountingComplete'] if stage else False)
        + '; cleanup verified: ' + str(engine['cleanup']) + '.',
    ]
    with (output / 'report.md').open('x', encoding='utf-8') as stream:
        stream.write('\n'.join(report) + '\n')


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


def phase_resource_summary(samples, start, end):
    """Point memory samples and fully-contained CPU counter intervals."""
    point_fields = ('memory_current', 'memory_peak', 'anon', 'file', 'shmem', 'kernel',
                    'memory_swap_current', 'read_seconds', 'gap_seconds')
    interval_fields = ('cpu_cores', 'cpu_budget_percent', 'delta_nr_throttled',
                       'delta_throttled_usec')
    points = [sample for sample in samples if start <= sample['time'] < end]
    intervals = [sample for previous, sample in zip(samples, samples[1:])
                 if previous['time'] >= start and sample['time'] < end]
    return {
        **{key: max((sample[key] for sample in points if sample.get(key) is not None), default=None)
           for key in point_fields},
        **{key: max((sample[key] for sample in intervals if sample.get(key) is not None), default=None)
           for key in interval_fields},
    }


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
    import sys
    values = list(sys.argv[1:] if argv is None else argv)
    if values[:1] == ['open-loop']:
        parser = argparse.ArgumentParser(description='Single-engine fixed-rate open-loop stage',
                                         allow_abbrev=False)
        parser.add_argument('mode', choices=('open-loop',))
        parser.add_argument('--engine', choices=('horizon', 'rizzo'), required=True)
        parser.add_argument('--candidate', choices=('A',), required=True)
        parser.add_argument('--image', required=True)
        parser.add_argument('--gold', type=Path, required=True)
        parser.add_argument('--rate', type=float, required=True)
        parser.add_argument('--stabilization-seconds', type=float, default=0.)
        parser.add_argument('--measurement-seconds', type=float, required=True)
        parser.add_argument('--drain-seconds', type=float, required=True)
        parser.add_argument('--socket-timeout-seconds', type=float, required=True)
        parser.add_argument('--max-client-inflight', type=int, required=True)
        parser.add_argument('--cpus', type=float, required=True)
        parser.add_argument('--memory', required=True)
        parser.add_argument('--budget-seconds', type=float, required=True)
        parser.add_argument('--output', type=Path, required=True)
        args = parser.parse_args(values)
        numeric = (args.rate, args.measurement_seconds, args.drain_seconds,
                   args.socket_timeout_seconds, args.budget_seconds)
        if (not all(math.isfinite(value) and value > 0 for value in numeric)
                or not math.isfinite(args.stabilization_seconds)
                or args.stabilization_seconds < 0
                or args.cpus != 2. or args.memory != '4000000000'
                or args.max_client_inflight <= 0
                or args.drain_seconds < args.socket_timeout_seconds + CLIENT_START_SLACK
                or args.budget_seconds < (args.stabilization_seconds
                                          + args.measurement_seconds
                                          + args.drain_seconds * (2 if args.stabilization_seconds else 1)
                                          + 25)
                or math.ceil(args.rate * max(args.measurement_seconds,
                                             args.stabilization_seconds)) > MAX_FIXED_RATE_ARRIVALS
                or not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/:@-]*', args.image)):
            parser.error('Invalid open-loop bounds or required 2 CPU/4000000000-byte envelope')
        args.memory = 4_000_000_000
        args.rerender = None
        return args
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
    args.mode = 'closed-loop'
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
        args.mode = 'rerender'
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
        (render_open_loop if receipt.get('schemaVersion') == 2 else render)(receipt, args.output)
        return 0
    # Bind validation and the receipt hash to the same immutable input bytes.
    gold_bytes = args.gold.read_bytes()
    cases = load_gold_bytes(gold_bytes)
    gold_sha256 = hashlib.sha256(gold_bytes).hexdigest()
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
        if args.mode == 'open-loop':
            receipt = open_loop_campaign(
                cases, engine=args.engine, image=args.image, cpus=args.cpus,
                memory=args.memory, rate=args.rate,
                measurement_seconds=args.measurement_seconds,
                stabilization_seconds=args.stabilization_seconds,
                drain_seconds=args.drain_seconds,
                socket_timeout=args.socket_timeout_seconds,
                max_client_inflight=args.max_client_inflight,
                budget_seconds=args.budget_seconds)
        else:
            receipt = campaign(cases, args.images, args.cpus, args.memory, args.budget_seconds)
        receipt['gold_sha256'] = gold_sha256
        (render_open_loop if args.mode == 'open-loop' else render)(
            receipt, args.output, reserved=True)
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
