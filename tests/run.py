#!/usr/bin/env python3
"""Run centralized suites from the repository root (optional suite names)."""
import argparse
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
SUITES = {
    'layout': [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests', '-p', 'test_layout.py', '-v'],
    'rizzo': ['npm', '--prefix', 'poc-rizzo', 'test'],
    'horizon': ['npm', '--prefix', 'poc-horizon', 'test'],
    'presidio': ['uv', 'run', '--project', 'poc-presidio', '--extra', 'dev', 'pytest', 'tests/presidio'],
    'evaluation': [sys.executable, '-m', 'unittest', 'discover', '-s', 'tests/evaluation/tests', '-v'],
    'contract': [sys.executable, 'tests/contract/run.py'],
}

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('suites', nargs='*', help='Default: all. Choices: ' + ', '.join(SUITES))
    args = parser.parse_args()
    if any(name not in SUITES for name in args.suites):
        parser.error('Unknown suite')
    results = {}
    for name in args.suites or SUITES:
        print(f'\n=== {name} ===', flush=True)
        results[name] = subprocess.run(SUITES[name], cwd=ROOT, check=False).returncode
    for name, code in results.items():
        print(f'{name}: {"PASS" if code == 0 else "FAIL"} (exit={code})')
    return 0 if all(code == 0 for code in results.values()) else 1

if __name__ == '__main__':
    sys.exit(main())
