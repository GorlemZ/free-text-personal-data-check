import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdtemp, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../poc-horizon/', import.meta.url));

test('TypeScript builds an import-safe service runnable from dist without source files', async () => {
  const config = JSON.parse(await readFile(join(root, 'tsconfig.json'), 'utf8'));
  assert.equal(config.compilerOptions.allowJs, false, 'production build must reject JavaScript sources');
  assert.equal(config.compilerOptions.strict, true);
  assert.equal(config.compilerOptions.module, 'NodeNext');
  assert.equal(config.compilerOptions.moduleResolution, 'NodeNext');
  assert.ok(config.include.includes('src/**/*.ts'), 'all service and CLI TypeScript must be compiled');
  const sources = await readdir(join(root, 'src'), { recursive: true });
  assert.deepEqual(sources.filter(name => /\.(?:mjs|mts|js)$/.test(name)), [],
    'production sources must be TypeScript, not mixed JavaScript/MTS');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.equal(pkg.type, 'module');
  assert.equal(pkg.scripts.start, 'node dist/index.js');
  assert.equal(pkg.scripts.prefetch, 'node dist/scripts/prefetch.js');

  const isolated = await mkdtemp(join(tmpdir(), 'horizon-dist-runtime-'));
  try {
    await cp(join(root, 'dist'), join(isolated, 'dist'), { recursive: true });
    await cp(join(root, 'package.json'), join(isolated, 'package.json'));
    await cp(join(root, 'model-manifest.json'), join(isolated, 'model-manifest.json'));
    await symlink(join(root, 'node_modules'), join(isolated, 'node_modules'), 'dir');
    const appUrl = pathToFileURL(join(isolated, 'dist/app.js')).href;
    const analysisUrl = pathToFileURL(join(isolated, 'dist/services/analysisService.js')).href;
    const rulesUrl = pathToFileURL(join(isolated, 'dist/services/ruleDetectionService.js')).href;
    const modelUrl = pathToFileURL(join(isolated, 'dist/services/modelDetectionService.js')).href;
    const registryUrl = pathToFileURL(join(isolated, 'dist/recognizers/registry.js')).href;
    const smokeUrl = pathToFileURL(join(isolated, 'dist/scripts/smoke.js')).href;
    const prefetchUrl = pathToFileURL(join(isolated, 'dist/scripts/prefetch.js')).href;
    const code = `
      import assert from 'node:assert/strict';
      import { createServer } from 'node:http';
      import { existsSync } from 'node:fs';
      const realFetch = globalThis.fetch;
      let forbiddenFetches = 0;
      globalThis.fetch = async () => { forbiddenFetches++; throw Error('forbidden runtime fetch'); };
      const { createApp } = await import(${JSON.stringify(appUrl)});
      const { analysisServiceBuilder } = await import(${JSON.stringify(analysisUrl)});
      const { ruleDetectionServiceBuilder } = await import(${JSON.stringify(rulesUrl)});
      const { modelDetectionServiceBuilder } = await import(${JSON.stringify(modelUrl)});
      const { recognizeItalianIdentifiers } = await import(${JSON.stringify(registryUrl)});
      const { smoke } = await import(${JSON.stringify(smokeUrl)});
      const { prefetch } = await import(${JSON.stringify(prefetchUrl)});
      assert.equal(typeof smoke, 'function');
      assert.equal(typeof prefetch, 'function');
      assert.equal(forbiddenFetches, 0, 'imports must not download artifacts or run inference');
      assert.equal(existsSync('src'), false);
      assert.equal(existsSync('models'), false, 'imports must not create model storage');
      let inferred = 0;
      const adapter = {
        ready: async () => true,
        prepare: text => ({ text }),
        infer: async () => { inferred++; return []; },
      };
      const server = createServer(createApp({
        ready: async () => true,
        analysisService: analysisServiceBuilder({
          ruleDetectionService: ruleDetectionServiceBuilder(recognizeItalianIdentifiers),
          modelDetectionService: modelDetectionServiceBuilder(adapter),
        }),
      }));
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      try {
        const origin = 'http://127.0.0.1:' + server.address().port;
        const ready = await realFetch(origin + '/health/ready');
        assert.equal(ready.status, 200);
        assert.deepEqual(await ready.json(), { status: 'ready' });
        const response = await realFetch(origin + '/v1/analyze', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fields: [{ fieldId: 'description', text: 'neutral fixture' }] }),
        });
        assert.equal(response.status, 200);
        assert.deepEqual(await response.json(), { verdict: 'accepted', findings: [] });
        assert.equal(inferred, 1);
        assert.equal(forbiddenFetches, 0);
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
      }
      console.log('dist-only runtime verified');
    `;
    const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
      cwd: isolated, encoding: 'utf8', timeout: 20_000,
      env: { ...process.env, TRANSFORMERS_OFFLINE: '1', HF_HUB_OFFLINE: '1' },
    });
    assert.equal(result.status, 0, `${result.stderr}\n${result.stdout}`);
    assert.equal(result.signal, null);
    assert.match(result.stdout, /dist-only runtime verified/);
  } finally {
    await rm(isolated, { recursive: true, force: true });
  }
});
