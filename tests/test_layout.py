"""Repository layout contract; run from the repository root."""
from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]

class LayoutTests(unittest.TestCase):
    def test_four_operational_directories(self):
        actual = {
            p.name for p in ROOT.iterdir()
            if p.is_dir() and not p.name.startswith('.') and p.name != 'node_modules'
        }
        self.assertEqual(actual, {'tests', 'poc-horizon', 'poc-rizzo', 'poc-presidio'})

    def test_test_suites_are_centralized(self):
        for name in ('horizon', 'rizzo', 'presidio'):
            self.assertTrue((ROOT / 'tests' / name).is_dir(), name)
            self.assertFalse((ROOT / ('poc-' + name) / 'tests').exists(), name)
        self.assertTrue((ROOT / 'tests' / 'evaluation' / 'runner.py').is_file())
        self.assertFalse((ROOT / 'tests' / 'evaluation' / 'prepare_gold.py').exists())

    def test_legacy_benchmarks_are_removed(self):
        self.assertFalse((ROOT / 'tests' / 'bench').exists())

    def test_typescript_pocs_use_one_pnpm_workspace(self):
        package = json.loads((ROOT / 'package.json').read_text())
        self.assertEqual(package['packageManager'], 'pnpm@10.29.3')
        self.assertEqual((ROOT / 'pnpm-workspace.yaml').read_text(),
                         'packages:\n  - poc-horizon\n  - poc-rizzo\n')
        self.assertTrue((ROOT / 'pnpm-lock.yaml').is_file())
        self.assertFalse((ROOT / 'poc-horizon' / 'package-lock.json').exists())
        self.assertFalse((ROOT / 'poc-rizzo' / 'package-lock.json').exists())

    def test_typescript_dockerfiles_use_root_pnpm_context(self):
        for engine, package in (
            ('horizon', 'poc-horizon-pii-check'),
            ('rizzo', 'node-rizzo-pii-spike'),
        ):
            directory = ROOT / ('poc-' + engine)
            dockerfile = (directory / 'Dockerfile').read_text()
            ignore = (directory / 'Dockerfile.dockerignore').read_text()
            self.assertIn('COPY package.json pnpm-workspace.yaml pnpm-lock.yaml ./', dockerfile)
            self.assertIn('pnpm@10.29.3', dockerfile)
            self.assertIn('--frozen-lockfile', dockerfile)
            self.assertIn('--filter ' + package, dockerfile)
            self.assertNotIn('npm ci', dockerfile)
            self.assertNotIn('prefetch', dockerfile)
            self.assertIn('test -z "$(command -v python || command -v python3)"', dockerfile)
            self.assertIn('.hermes', ignore)
            self.assertIn('tests', ignore)
            other = 'poc-rizzo/models' if engine == 'horizon' else 'poc-horizon/models'
            self.assertIn(other, ignore)

    def test_typescript_documentation_uses_workspace_commands(self):
        for engine, package in (
            ('horizon', 'poc-horizon-pii-check'),
            ('rizzo', 'node-rizzo-pii-spike'),
        ):
            readme = (ROOT / ('poc-' + engine) / 'README.md').read_text()
            self.assertNotIn('npm --prefix', readme)
            self.assertNotIn('npm test', readme)
            self.assertIn('pnpm --filter ' + package, readme)
            self.assertIn(
                'docker build -f poc-' + engine + '/Dockerfile',
                readme,
            )

        tests_readme = (ROOT / 'tests' / 'README.md').read_text()
        self.assertNotIn('npm --prefix', tests_readme)
        self.assertIn('pnpm install --frozen-lockfile', tests_readme)
        self.assertIn('pnpm test', tests_readme)

        runner = (ROOT / 'tests' / 'run.py').read_text()
        self.assertNotIn("['npm', '--prefix'", runner)
        self.assertIn("['pnpm', 'test:rizzo']", runner)
        self.assertIn("['pnpm', 'test:horizon']", runner)

if __name__ == '__main__':
    unittest.main()
