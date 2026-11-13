import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { sandbox, child } from './support/sandbox.mjs';

test('compiled prefetch CLI verifies only synthetic local files from a foreign cwd without downloading', async t => {
  const { pkg, cwd } = await sandbox(t);
  await mkdir(join(pkg, 'models'));
  const bytes = 'synthetic fixture, never weights';
  await writeFile(join(pkg, 'models/fixture.bin'), bytes);
  await writeFile(join(pkg, 'model-manifest.json'), JSON.stringify({ repository: 'synthetic/test', revision: 'test', files: { 'fixture.bin': createHash('sha256').update(bytes).digest('hex') } }));
  const hook = `globalThis.fetch = async () => { throw Error('FORBIDDEN_CLI_DOWNLOAD'); };`;
  const result = child('', cwd, ['--import', 'data:text/javascript,' + encodeURIComponent(hook), join(pkg, 'dist/scripts/prefetch.js')]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.equal(result.stdout.trim(), 'fixture.bin: verified existing');
});

test('compiled smoke CLI executes guarded main with synthetic inference and preserves its token-error assertion', async t => {
  const { pkg, cwd } = await sandbox(t);
  const smokeURL = pathToFileURL(join(pkg, 'dist/scripts/smoke.js')).href;
  const fixture = `
    let calls = 0;
    export async function composeRuntime() {
      return { adapter: { warmup: async () => {} }, modelDetectionService: async text => { calls++; if (text.length > 10000) throw Error('TOKEN_LIMIT'); return new Set(text.includes('@') ? ['EMAIL_ADDRESS'] : ['PERSON']); } };
    }
    process.on('beforeExit', () => { if (calls !== 3) throw Error('SMOKE_CLI_NOT_EXECUTED'); });
  `;
  const hook = `
    import { registerHooks } from 'node:module';
    globalThis.fetch = async () => { throw Error('FORBIDDEN_CLI_DOWNLOAD'); };
    registerHooks({ resolve(specifier, context, next) {
      if (specifier === '../index.js' && context.parentURL === ${JSON.stringify(smokeURL)}) return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(fixture))}, shortCircuit: true };
      return next(specifier, context);
    } });
  `;
  const result = child('', cwd, ['--import', 'data:text/javascript,' + encodeURIComponent(hook), join(pkg, 'dist/scripts/smoke.js')]);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.deepEqual(result.stdout.trim().split('\n').map(line => JSON.parse(line)), [
    { id: 'name', categories: ['PERSON'] },
    { id: 'email-tail', categories: ['EMAIL_ADDRESS'] },
    { overTokenLimit: 'explicit-technical-error', runtime: 'node', result: 'PASS' },
  ]);
});
