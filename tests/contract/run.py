#!/usr/bin/env python3
"""Run one shared HTTP contract against production handlers.

Local servers replace only native inference output, upstream of semantic
mapping. --base ENGINE=URL instead selects inference-independent smoke cases
against an already-running real service; it never injects detector output.
"""
import argparse
import http.client
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = Path(__file__).with_name('fixtures.json')
COMMANDS = {
    'rizzo': ['node', 'tests/contract/serve-rizzo.mjs'],
    'horizon': ['node', 'tests/contract/serve-horizon.mjs'],
    'presidio': ['uv', 'run', '--project', 'poc-presidio', '--extra', 'dev',
                 'python', 'tests/contract/serve-presidio.py'],
}


def request(base, case):
    parsed = urlsplit(base)
    if parsed.scheme != 'http' or parsed.path not in ('', '/') or parsed.query:
        raise ValueError('Expected an HTTP origin without path or query')
    body = None
    if 'json' in case:
        body = json.dumps(case['json'], ensure_ascii=True, separators=(',', ':')).encode('utf-8')
    elif 'body_text' in case:
        body = case['body_text'].encode('utf-8')
    elif 'body_hex' in case:
        body = bytes.fromhex(case['body_hex'])
    elif 'repeat_bytes' in case:
        body = b'x' * case['repeat_bytes']
    connection = http.client.HTTPConnection(parsed.hostname, parsed.port or 80, timeout=30)
    try:
        connection.request(case['method'], case['path'], body=body, headers=case['headers'])
        response = connection.getresponse()
        raw = response.read(2 * 1024 * 1024)
        content_type = response.getheader('Content-Type', '').split(';')[0].strip().lower()
        return response.status, json.loads(raw.decode('utf-8')), content_type
    finally:
        connection.close()


def await_server(base, process, mode):
    deadline = time.monotonic() + 45
    probe = {'method': 'GET', 'path': '/health/ready', 'headers': {}}
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f'Test server exited with code {process.returncode}')
        try:
            status, body, _ = request(base, probe)
            expected_status = 503 if mode == 'unavailable' else 200
            if status == expected_status:
                return
        except (OSError, ValueError, http.client.HTTPException):
            pass
        time.sleep(.1)
    raise RuntimeError('Test server readiness deadline exceeded')


def check_cases(base, cases, engine):
    failures = []
    for case in cases:
        try:
            status, body, content_type = request(base, case)
            if (status != case['status'] or body != case['expected'] or content_type != 'application/json'):
                # Only test name/status/schema comparison: never emit response contents.
                failures.append({'case':case['name'], 'status':status, 'expectedStatus':case['status'],
                                 'bodyMatches':body == case['expected'], 'jsonContentType':content_type == 'application/json'})
        except (OSError, ValueError, http.client.HTTPException) as exc:
            failures.append({'case':case['name'], 'error':type(exc).__name__})
    return {'engine':engine, 'checks':len(cases), 'passed':len(cases)-len(failures), 'failures':failures}


def local_checks(engine, cases):
    results = []
    for mode in ('ready', 'unavailable'):
        subset = [case for case in cases if case['mode'] == mode]
        with socket.socket() as sock:
            sock.bind(('127.0.0.1', 0))
            port = sock.getsockname()[1]
        env = {**os.environ, 'PORT':str(port), 'CONTRACT_UNAVAILABLE':'1' if mode == 'unavailable' else '0'}
        process = subprocess.Popen(COMMANDS[engine], cwd=ROOT, env=env, stdout=subprocess.DEVNULL)
        base = f'http://127.0.0.1:{port}'
        try:
            await_server(base, process, mode)
            result = check_cases(base, subset, engine)
            result['mode'] = mode
            results.append(result)
        finally:
            if process.poll() is None:
                process.terminate()
                try:
                    process.wait(timeout=8)
                except subprocess.TimeoutExpired:
                    process.kill()
                    process.wait(timeout=5)
    return results


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--engine', action='append', choices=tuple(COMMANDS), help='Default: all three')
    parser.add_argument('--base', action='append', default=[], metavar='ENGINE=URL', help='Real-service smoke only; no child process')
    args = parser.parse_args()
    cases = json.loads(FIXTURES.read_text())['cases']
    names = [case['name'] for case in cases]
    if len(names) != len(set(names)):
        raise ValueError('Duplicate fixture names')
    results = []
    if args.base:
        for entry in args.base:
            engine, base = entry.split('=', 1)
            if engine not in COMMANDS:
                parser.error('Unknown engine')
            results.append(check_cases(base, [c for c in cases if c.get('realSmoke')], engine))
    else:
        for engine in args.engine or list(COMMANDS):
            results.extend(local_checks(engine, cases))
    report = {'checks':sum(r['checks'] for r in results), 'passed':sum(r['passed'] for r in results), 'results':results}
    print(json.dumps(report, ensure_ascii=True, indent=2))
    return 0 if report['checks'] == report['passed'] else 1


if __name__ == '__main__':
    sys.exit(main())
