import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../poc-rizzo/', import.meta.url));
test('strict TypeScript layout and dist-only commands cover every production module', async () => {
  assert.ok(existsSync(root + 'tsconfig.json'), 'TS_LAYOUT_REQUIRED: missing strict TypeScript build');
  const { compilerOptions: c, include } = JSON.parse(await readFile(root + 'tsconfig.json', 'utf8'));
  for (const [key, value] of Object.entries({ target: 'ES2022', module: 'NodeNext', moduleResolution: 'NodeNext', rootDir: 'src', outDir: 'dist', strict: true, exactOptionalPropertyTypes: true, noEmitOnError: true, allowJs: false })) assert.equal(c[key], value, key);
  assert.deepEqual(c.lib, ['ES2024']);
  assert.ok(include.includes('src/**/*.ts'));
  const sources = await readdir(root + 'src', { recursive: true });
  assert.deepEqual(sources.filter(name => /\.(?:mjs|mts|js)$/.test(name)), []);
  for (const name of ['app.ts', 'index.ts', 'adapters/transformersAdapter.ts', 'model/contracts.ts', 'model/categories.ts', 'model/modelInterpretation.ts', 'model/fieldPolicy.ts', 'recognizers/rules.ts', 'services/analysisService.ts', 'services/modelDetectionService.ts', 'services/ruleDetectionService.ts', 'scripts/prefetch.ts', 'scripts/smoke.ts']) assert.ok(sources.includes(name), name);
  for (const name of ['model', 'detector', 'categories', 'rules']) { assert.equal(sources.includes(name + '.ts'), false); assert.equal(existsSync(root + 'dist/' + name + '.js'), false); }
  const { scripts, devDependencies } = JSON.parse(await readFile(root + 'package.json', 'utf8'));
  assert.equal(scripts.start, 'node dist/index.js');
  assert.equal(scripts.prefetch, 'node dist/scripts/prefetch.js');
  assert.equal(scripts.smoke, 'node dist/scripts/smoke.js');
  assert.match(scripts.test, /^npm run build && node --test /, 'TEST_COMMAND_REQUIRES_BUILD: centralized harness must work without existing dist');
  assert.deepEqual(devDependencies, { '@types/node': '26.6.6', typescript: '5.9.3' });
  assert.equal(existsSync(root + 'scripts/prefetch.mjs'), false);
  assert.equal(existsSync(root + 'scripts/smoke.mjs'), false);
});
