// Synthetic M1 boundary probes. Real SDK tokenizer; never load weights or use the network.
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { cleanEnv, root } from './sandbox.mjs';

export const tokenizerJSON = JSON.stringify({ version: '1.0', truncation: null, padding: null, added_tokens: [], normalizer: null, pre_tokenizer: { type: 'Whitespace' }, post_processor: null, decoder: null, model: { type: 'WordLevel', vocab: { '[UNK]': 0, Ada: 1 }, unk_token: '[UNK]' } });
export const configCases = [
  { name: 'numeric-control', config: { max_position_embeddings: 3 } },
  { name: 'string-limit', config: { max_position_embeddings: '3' } },
  { name: 'boolean-limit', config: { max_position_embeddings: false } },
  { name: 'missing-limit', config: {} },
  { name: 'string-limit-missing-tokenizer', config: { max_position_embeddings: '3' }, tokenizer: 'missing' },
  { name: 'null-config-missing-tokenizer', config: null, tokenizer: 'missing' },
  { name: 'null-config-malformed-tokenizer', config: null, tokenizer: 'malformed' },
  { name: 'null-config-valid-tokenizer', config: null },
  { name: 'config-budget-reread', config: { max_position_embeddings: 3 }, reread: true },
];
export const manifestCases = [
  { name: 'null-files', manifest: { files: null } },
  { name: 'null-manifest-root', manifest: null },
  { name: 'numeric-manifest-root', manifest: 42 },
  { name: 'array-manifest-root', manifest: [] },
  { name: 'array-files-empty', manifest: { files: [] } },
  { name: 'array-files-entry', arrayEntry: true },
  { name: 'numeric-files', manifest: { files: 42 } },
  { name: 'boolean-files', manifest: { files: true } },
  { name: 'empty-string-files', manifest: { files: '' } },
  { name: 'string-files-entry', manifest: { files: 'a' }, badHash: true },
];
const sha = value => createHash('sha256').update(value).digest('hex');
export async function modelCase(t, scenario, moduleURL = pathToFileURL(join(root, 'dist/adapters/transformersAdapter.js')).href) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'rizzo-m1-model-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const files = { 'config.json': JSON.stringify(Object.hasOwn(scenario, 'config') ? scenario.config : { max_position_embeddings: 3 }) };
  if (scenario.tokenizer !== 'missing') files['tokenizer.json'] = scenario.tokenizer === 'malformed' ? '{"broken":' : tokenizerJSON;
  if (scenario.arrayEntry || scenario.badHash) files['0'] = 'synthetic artifact, not weights';
  for (const [name, bytes] of Object.entries(files)) await fs.writeFile(join(directory, name), bytes);
  const manifest = scenario.arrayEntry ? { files: [sha(files['0'])] } : Object.hasOwn(scenario, 'manifest') ? scenario.manifest : { files: Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, sha(bytes)])) };
  await fs.writeFile(join(directory, 'manifest.json'), JSON.stringify(manifest));
  const input = { mode: 'model', moduleURL, directory, reread: !!scenario.reread, configText: files['config.json'], tokenizerText: files['tokenizer.json'] };
  return { ...runWorker(input, directory), directory, manifest, files };
}
function runWorker(input, cwd) {
  const r = spawnSync(process.execPath, [fileURLToPath(new URL('./legacy-startup-worker.mjs', import.meta.url)), JSON.stringify(input)], { cwd, env: cleanEnv(), encoding: 'utf8', timeout: 20000 });
  assert.ifError(r.error); assert.equal(r.signal, null, r.stderr); assert.equal(r.status, 0, r.stdout + r.stderr);
  return JSON.parse(r.stdout.trim());
}
export const cliCases = [
  { name: 'cli-local-missing-unused-repository-revision', cli: true, local: true },
  { name: 'cli-null-manifest-root', cli: true, manifest: null },
  { name: 'cli-null-files', cli: true, manifest: { files: null } },
  { name: 'cli-numeric-manifest-root', cli: true, manifest: 42 },
  { name: 'cli-malformed-manifest', cli: true, malformed: true },
  { name: 'cli-array-files-empty', cli: true, manifest: { files: [] } },
  { name: 'cli-array-files-entry', cli: true, arrayEntry: true, local: true },
  { name: 'cli-numeric-files', cli: true, manifest: { files: 42 } },
  { name: 'cli-boolean-files', cli: true, manifest: { files: true } },
  { name: 'cli-empty-string-files', cli: true, manifest: { files: '' } },
  { name: 'cli-string-files-entry', cli: true, manifest: { files: 'a' }, fetch: true, file: '0' },
  { name: 'cli-missing-local-fetch-branch', cli: true, fetch: true },
  { name: 'cli-corrupt-local-fetch-branch', cli: true, local: true, corrupt: true, fetch: true },
];
export async function cliCase(t, scenario, source = join(root, 'dist/scripts/prefetch.js'), legacy = false) {
  const directory = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'rizzo-m1-cli-')));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  const filename = scenario.file ?? (scenario.arrayEntry ? '0' : 'fixture.bin');
  const bytes = 'synthetic local artifact, never model weights';
  const manifest = Object.hasOwn(scenario, 'manifest') ? scenario.manifest : { files: scenario.arrayEntry ? [sha(bytes)] : { [filename]: sha(bytes) } };
  const manifestText = scenario.malformed ? '{"broken":' : JSON.stringify(manifest);
  await fs.writeFile(join(directory, 'model-manifest.json'), manifestText);
  await fs.writeFile(join(directory, 'package.json'), '{"type":"module"}');
  if (scenario.local) { await fs.mkdir(join(directory, 'models')); await fs.writeFile(join(directory, 'models', filename), scenario.corrupt ? 'wrong synthetic bytes' : bytes); }
  const script = join(directory, legacy ? 'scripts/prefetch.mjs' : 'dist/scripts/prefetch.js');
  await fs.mkdir(new URL('.', pathToFileURL(script)), { recursive: true });
  await fs.copyFile(source, script);
  const report = join(directory, 'observation.json');
  const input = { directory, report, manifestText };
  const hook = `import {observe} from ${JSON.stringify(new URL('./legacy-prefetch-observer.mjs', import.meta.url).href)};observe(${JSON.stringify(input)});`;
  const result = spawnSync(process.execPath, ['--import', 'data:text/javascript,' + encodeURIComponent(hook), script], { cwd: tmpdir(), env: cleanEnv(), encoding: 'utf8', timeout: 20000 });
  assert.ifError(result.error);assert.equal(result.signal,null,result.stderr);
  const observation = JSON.parse(await fs.readFile(report,'utf8'));
  assert.equal(result.status,observation.status,result.stderr);
  return {...observation,stdout:result.stdout.trim(),directory,manifest,manifestText};
}
export function assertCliCase(actual, scenario) {
  const trace = ['read:manifest','parse:manifest'];
  let error = null;
  if (scenario.malformed) {
    let original;try {JSON.parse(actual.manifestText);} catch(caught) {original=caught;}
    error = {name:original.name,code:null,message:original.message,identity:'parse'};
  } else {
    trace.push('mkdir:models');
    if (actual.manifest !== null && typeof actual.manifest === 'object') trace.push('manifest:files');
    if (actual.manifest === null) error = {name:'TypeError',code:null,message:"Cannot read properties of null (reading 'files')",identity:null};
    else if (actual.manifest.files == null) error = {name:'TypeError',code:null,message:'Cannot convert undefined or null to object',identity:null};
    else {
      for(const name of Object.keys(Object(actual.manifest.files))) trace.push('hash:'+name);
      if(scenario.fetch) {
        trace.push('manifest:repository','manifest:revision',`fetch:https://huggingface.co/undefined/resolve/undefined/${scenario.file ?? 'fixture.bin'}`);
        error = {name:'Error',code:'M1_SENTINEL',message:'M1_CLI_FETCH_SENTINEL',identity:'fetch'};
      }
    }
  }
  assert.deepEqual(actual.trace,trace,scenario.name+': LEGACY_CLI_CALL_ORDER_CHANGED');
  assert.deepEqual(actual.error,error,scenario.name+': LEGACY_CLI_ERROR_CHANGED');
  assert.equal(actual.status,error ? 1 : 0,scenario.name+': LEGACY_CLI_EXIT_CHANGED');
  assert.equal(actual.modelsExists,!scenario.malformed,scenario.name+': LEGACY_MKDIR_SIDE_EFFECT_CHANGED');
  assert.equal(actual.stdout,scenario.local && !scenario.fetch ? `${scenario.arrayEntry ? '0' : 'fixture.bin'}: verified existing` : '');
  assert.equal(actual.fetchCalls,scenario.fetch ? 1 : 0);
}
export function assertModelCase(actual, scenario) {
  const { directory, manifest, files } = actual;
  const trace = ['read:manifest.json', 'parse:manifest'];
  let error;
  if (manifest === null) error = { name: 'TypeError', code: null, message: "Cannot read properties of null (reading 'files')", identity: null };
  else if (manifest.files == null) error = { name: 'TypeError', code: null, message: 'Cannot convert undefined or null to object', identity: null };
  else {
    for (const name of Object.keys(Object(manifest.files))) trace.push('hash:' + name);
    if (scenario.badHash) error = { name: 'Error', code: null, message: 'MODEL_INTEGRITY_FAILURE', identity: null };
    else {
      trace.push('read:config.json', 'parse:config', 'read:tokenizer.json');
      if (scenario.tokenizer === 'missing') error = { name: 'Error', code: 'ENOENT', message: `ENOENT: no such file or directory, open '${join(directory, 'tokenizer.json')}'`, identity: 'filesystem' };
      else {
        trace.push('parse:tokenizer');
        if (scenario.tokenizer === 'malformed') {
          // Node's original parser supplies the exact engine-specific message.
          let original; try { JSON.parse(files['tokenizer.json']); } catch (caught) { original = caught; }
          error = { name: original.name, code: null, message: original.message, identity: 'parse' };
        } else if (scenario.config === null) error = { name: 'TypeError', code: null, message: "Cannot read properties of null (reading 'max_position_embeddings')", identity: null };
        else {
          trace.push('config:get', 'loader');
          if (scenario.reread) trace.push('config:get');
          error = { name: 'Error', code: 'M1_SENTINEL', message: scenario.reread ? 'M1_CONFIG_REREAD_SENTINEL' : 'M1_LOADER_SENTINEL', identity: scenario.reread ? 'config-reread' : 'loader' };
        }
      }
    }
  }
  assert.deepEqual(actual.trace, trace, scenario.name + ': LEGACY_CALL_ORDER_CHANGED');
  assert.deepEqual(actual.error, error, scenario.name + ': LEGACY_ERROR_CHANGED');
  assert.equal(actual.fetchCalls, 0, 'network must never be attempted');
}
