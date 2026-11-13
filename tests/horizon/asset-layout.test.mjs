import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = fileURLToPath(new URL('../../poc-horizon/', import.meta.url));
const mutants = [
  { name: 'none', diagnostic: null },
  { name: 'detector-models', diagnostic: 'DETECTOR_MODEL_PATH' },
  { name: 'cli-models', diagnostic: 'CLI_MODEL_PATH' },
  { name: 'manifest', diagnostic: 'CLI_MANIFEST_PATH' },
];

for (const { name, diagnostic } of mutants) {
  test(`dist-only asset resolution from foreign cwd: ${name}`, async () => {
    const temporary = await mkdtemp(join(tmpdir(), 'horizon-asset-layout-'));
    try {
      // Canonicalize the owned sandbox to avoid macOS /var versus /private/var aliases.
      const isolated = await realpath(temporary);
      const pkg = join(isolated, 'package');
      const cwd = join(isolated, 'foreign-working-directory');
      await mkdir(pkg);
      await mkdir(cwd);
      await cp(join(root, 'dist'), join(pkg, 'dist'), { recursive: true });
      await cp(join(root, 'package.json'), join(pkg, 'package.json'));
      await cp(join(root, 'model-manifest.json'), join(pkg, 'model-manifest.json'));
      await symlink(join(root, 'node_modules'), join(pkg, 'node_modules'), 'dir');
      const detectorUrl = pathToFileURL(join(pkg, 'dist/adapters/transformersAdapter.js')).href;
      const configUrl = pathToFileURL(join(pkg, 'dist/config/config.js')).href;
      const prefetchUrl = pathToFileURL(join(pkg, 'dist/scripts/prefetch.js')).href;
      const indexUrl = pathToFileURL(join(pkg, 'dist/index.js')).href;
      const expectedModels = join(pkg, 'models');
      const expectedManifest = pathToFileURL(join(pkg, 'model-manifest.json')).href;
      const sdk = `
        export const env = {};
        export async function pipeline(task, model, options) {
          globalThis.__assetProbe.pipelines.push({ task, model, options });
          const detector = async () => [];
          detector.tokenizer = () => ({ input_ids: { size: 1 } });
          return detector;
        }
      `;
      const filesystem = `
        export async function readFile(path) {
          globalThis.__assetProbe.manifests.push(String(path));
          return JSON.stringify({ model: 'synthetic/layout-fixture', revision: 'test-only',
            files: [{ path: 'fixture.txt', size: 7 }] });
        }
        export async function stat(path) {
          globalThis.__assetProbe.files.push(path);
          return { size: 7 };
        }
        async function forbidden() { throw Error('forbidden filesystem mutation'); }
        export { forbidden as mkdir, forbidden as rename, forbidden as rm };
      `;
      const sdkUrl = `data:text/javascript,${encodeURIComponent(sdk)}`;
      const filesystemUrl = `data:text/javascript,${encodeURIComponent(filesystem)}`;
      const code = `
        import assert from 'node:assert/strict';
        import { registerHooks } from 'node:module';
        import { existsSync } from 'node:fs';
        globalThis.__assetProbe = { pipelines: [], manifests: [], files: [], fetches: 0 };
        globalThis.fetch = async () => {
          globalThis.__assetProbe.fetches++;
          throw Error('forbidden model fetch');
        };
        const detectorUrl = ${JSON.stringify(detectorUrl)};
        const prefetchUrl = ${JSON.stringify(prefetchUrl)};
        const configUrl = ${JSON.stringify(configUrl)};
        const mutant = ${JSON.stringify(name)};
        registerHooks({
          resolve(specifier, context, next) {
            if (specifier === '@huggingface/transformers' && context.parentURL === detectorUrl)
              return { url: ${JSON.stringify(sdkUrl)}, shortCircuit: true };
            if (specifier === 'node:fs/promises' && context.parentURL === prefetchUrl)
              return { url: ${JSON.stringify(filesystemUrl)}, shortCircuit: true };
            return next(specifier, context);
          },
          load(url, context, next) {
            const result = next(url, context);
            let from;
            let to;
            if (mutant === 'detector-models' && url === detectorUrl) {
              from = "MODEL_CONFIG.root + '/'"; to = "MODEL_CONFIG.root + '/wrong/'";
            }
            if (mutant === 'cli-models' && url === prefetchUrl) {
              from = 'const root = MODEL_CONFIG.root;'; to = "const root = MODEL_CONFIG.root + '/wrong';";
            }
            if (mutant === 'manifest' && url === configUrl) {
              from = '../../model-manifest.json'; to = '../model-manifest.json';
            }
            if (!from) return result;
            const source = String(result.source);
            assert.ok(source.includes(from), 'missing mutation target');
            return { ...result, source: source.replace(from, to) };
          },
        });
        const { transformersAdapterBuilder } = await import(detectorUrl);
        const { prefetch } = await import(prefetchUrl);
        await import(${JSON.stringify(indexUrl)});
        const { env } = await import(${JSON.stringify(sdkUrl)});
        const probe = globalThis.__assetProbe;
        assert.deepEqual(probe.pipelines, [], 'imports must not initialize the model');
        assert.deepEqual(probe.manifests, [], 'imports must not read the manifest');
        assert.deepEqual(env, {}, 'imports must not configure the SDK');
        const adapter = transformersAdapterBuilder();
        await adapter.ready();
        assert.equal(env.localModelPath, ${JSON.stringify(expectedModels + '/')}, 'DETECTOR_MODEL_PATH');
        assert.equal(env.allowRemoteModels, false);
        assert.equal(env.allowLocalModels, true);
        assert.equal(env.useBrowserCache, false);

        assert.deepEqual(probe.pipelines, [{ task: 'token-classification',
          model: 'Horizon-Labs/pii-redactor-base',
          options: { dtype: 'q8', device: 'cpu', local_files_only: true } }]);
        // Only filesystem fixtures are used: no actual artifact or checksum is read.
        await prefetch({ verifyOnly: true });
        assert.deepEqual(probe.manifests, [${JSON.stringify(expectedManifest)}], 'CLI_MANIFEST_PATH');
        assert.deepEqual(probe.files, [${JSON.stringify(join(expectedModels, 'synthetic/layout-fixture/fixture.txt'))}],
          'CLI_MODEL_PATH');
        assert.equal(probe.fetches, 0);
        assert.equal(existsSync(${JSON.stringify(expectedModels)}), false);
        assert.equal(existsSync(${JSON.stringify(join(pkg, 'src'))}), false);
        console.log('synthetic asset paths verified');
      `;
      const result = spawnSync(process.execPath, ['--input-type=module', '--eval', code], {
        cwd, encoding: 'utf8', timeout: 20_000,
        env: { ...process.env, TRANSFORMERS_OFFLINE: '1', HF_HUB_OFFLINE: '1' },
      });
      assert.ifError(result.error);
      assert.equal(result.signal, null);
      if (diagnostic === null) {
        assert.equal(result.status, 0, result.stderr + result.stdout);
        assert.match(result.stdout, /synthetic asset paths verified/);
      } else {
        assert.equal(result.status, 1, 'a wrong production path must make the probe RED');
        assert.match(result.stderr, new RegExp(diagnostic), 'failure must identify the corrupted asset path');
        assert.doesNotMatch(result.stderr, /missing mutation target/);
      }
    } finally {
      await rm(temporary, { recursive: true, force: true });
    }
  });
}
