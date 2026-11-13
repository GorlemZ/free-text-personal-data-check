import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { sandbox, child } from './support/sandbox.mjs';

for (const [mutant, diagnostic] of [['none', null], ['model-root', 'MODEL_DIRECTORY'], ['cli-root', 'CLI_MODEL_DIRECTORY'], ['cli-manifest', 'CLI_MANIFEST_PATH']]) {
  test('compiled runtime asset observation and mutation control: ' + mutant, async t => {
    const { pkg, cwd } = await sandbox(t);
    const configURL = pathToFileURL(join(pkg, 'dist/config/modelConfig.js')).href;
    const modelURL = pathToFileURL(join(pkg, 'dist/adapters/transformersAdapter.js')).href;
    const prefetchURL = pathToFileURL(join(pkg, 'dist/scripts/prefetch.js')).href;
    const indexURL = pathToFileURL(join(pkg, 'dist/index.js')).href;
    const smokeURL = pathToFileURL(join(pkg, 'dist/scripts/smoke.js')).href;
    const digest = createHash('sha256').update('synthetic').digest('hex');
    const sdk = `
      export const env = {};
      export const AutoModelForTokenClassification = { async from_pretrained(path, options) { globalThis.probe.loads.push({ path, options }); return {}; } };
      export class PreTrainedTokenizer { constructor() { return () => ({ input_ids: { data: [1] } }); } }
      export class TokenClassificationPipeline { constructor() { return async () => []; } }
    `;
    const filesystem = `
      export async function readFile(path) {
        globalThis.probe.reads.push(String(path));
        if (String(path).endsWith('config.json')) return JSON.stringify({ max_position_embeddings: 3 });
        if (String(path).endsWith('tokenizer.json')) return '{}';
        return JSON.stringify({ repository: 'synthetic/test', revision: 'test-only', files: { 'fixture.bin': '${digest}' } });
      }
      export async function mkdir(path) { globalThis.probe.mkdirs.push(String(path)); }
      async function forbidden() { throw Error('forbidden fixture filesystem mutation'); }
      export { forbidden as rm, forbidden as rename };
    `;
    const streams = `
      import { Readable } from 'node:stream';
      export function createReadStream(path) { globalThis.probe.streams.push(String(path)); return Readable.from(['synthetic']); }
      export function createWriteStream() { throw Error('forbidden fixture write'); }
    `;
    const sdkURL = 'data:text/javascript,' + encodeURIComponent(sdk);
    const fsURL = 'data:text/javascript,' + encodeURIComponent(filesystem);
    const streamsURL = 'data:text/javascript,' + encodeURIComponent(streams);
    const code = `
      import assert from 'node:assert/strict';
      import { registerHooks } from 'node:module';
      import http from 'node:http';
      import { existsSync } from 'node:fs';
      globalThis.probe = { reads: [], loads: [], streams: [], mkdirs: [], fetches: 0, mutations: 0 };
      globalThis.fetch = async () => { probe.fetches++; throw Error('forbidden asset fetch'); };
      http.Server.prototype.listen = () => { throw Error('forbidden import listen'); };
      const modelURL = ${JSON.stringify(modelURL)}, prefetchURL = ${JSON.stringify(prefetchURL)};
      const mutant = ${JSON.stringify(mutant)};
      registerHooks({
        resolve(specifier, context, next) {
          if (specifier === '@huggingface/transformers' && context.parentURL === modelURL) return { url: ${JSON.stringify(sdkURL)}, shortCircuit: true };
          if (specifier === 'node:fs/promises' && [modelURL, prefetchURL].includes(context.parentURL)) return { url: ${JSON.stringify(fsURL)}, shortCircuit: true };
          if (specifier === 'node:fs' && [modelURL, prefetchURL].includes(context.parentURL)) return { url: ${JSON.stringify(streamsURL)}, shortCircuit: true };
          return next(specifier, context);
        },
        load(url, context, next) {
          const result = next(url, context);
          let from, to;
          if (mutant === 'model-root' && url === ${JSON.stringify(configURL)}) { from = "new URL('../../models/', import.meta.url)"; to = "new URL('../../wrong-models/', import.meta.url)"; }
          if (mutant === 'cli-root' && url === prefetchURL) { from = "new URL('../../models/', import.meta.url)"; to = "new URL('../models/', import.meta.url)"; }
          if (mutant === 'cli-manifest' && url === prefetchURL) { from = "new URL('../../model-manifest.json', import.meta.url)"; to = "new URL('../model-manifest.json', import.meta.url)"; }
          if (!from) return result;
          assert.ok(String(result.source).includes(from), 'MISSING_MUTATION_TARGET');
          probe.mutations++;
          return { ...result, source: String(result.source).replace(from, to) };
        },
      });
      const { transformersAdapterBuilder } = await import(modelURL);
      const { prefetch } = await import(prefetchURL);
      await import(${JSON.stringify(indexURL)});
      await import(${JSON.stringify(smokeURL)});
      assert.deepEqual(probe.reads, [], 'imports must not read model assets');
      assert.deepEqual(probe.loads, [], 'imports must not initialize the model');
      assert.deepEqual(probe.mkdirs, [], 'CLI import must not create model directories');
      const { env } = await import(${JSON.stringify(sdkURL)});
      assert.deepEqual(env, {}, 'import must not configure SDK');
      await transformersAdapterBuilder().warmup();
      assert.equal(env.allowRemoteModels, false);
      assert.deepEqual(probe.loads, [{ path: ${JSON.stringify(join(pkg, 'models') + '/')}, options: { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true } }], 'MODEL_DIRECTORY');
      assert.deepEqual(probe.reads, [${JSON.stringify(pathToFileURL(join(pkg, 'model-manifest.json')).href)}, ${JSON.stringify(pathToFileURL(join(pkg, 'models/config.json')).href)}, ${JSON.stringify(pathToFileURL(join(pkg, 'models/tokenizer.json')).href)}], 'MODEL_MANIFEST_PATH');
      probe.reads.length = 0;
      probe.streams.length = 0;
      await prefetch();
      assert.deepEqual(probe.reads, [${JSON.stringify(pathToFileURL(join(pkg, 'model-manifest.json')).href)}], 'CLI_MANIFEST_PATH');
      assert.deepEqual(probe.mkdirs, [${JSON.stringify(pathToFileURL(join(pkg, 'models/')).href)}], 'CLI_MODEL_DIRECTORY');
      assert.deepEqual(probe.streams, [${JSON.stringify(pathToFileURL(join(pkg, 'models/fixture.bin')).href)}], 'CLI_MODEL_DIRECTORY');
      assert.equal(probe.fetches, 0);
      assert.equal(probe.mutations, mutant === 'none' ? 0 : 1);
      assert.equal(existsSync(${JSON.stringify(join(pkg, 'models'))}), false);
      assert.equal(existsSync(${JSON.stringify(join(pkg, 'src'))}), false);
      console.log('ASSET_OBSERVATION_PASS');
    `;
    const result = child(code, cwd);
    if (diagnostic === null) {
      assert.equal(result.status, 0, result.stderr + result.stdout);
      assert.match(result.stdout, /ASSET_OBSERVATION_PASS/);
    } else {
      assert.equal(result.status, 1);
      assert.match(result.stderr, new RegExp(diagnostic));
      assert.doesNotMatch(result.stderr, /MISSING_MUTATION_TARGET|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/);
    }
  });
}
