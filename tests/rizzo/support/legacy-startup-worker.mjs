// One initialization per process prevents the deliberately sticky failed cache leaking.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';
const input = JSON.parse(process.argv[2]);
assert.equal(fs.realpathSync(tmpdir()), fs.realpathSync(process.env.TMPDIR));
const trace = [];
let fetchCalls = 0, filesystemError, parseError, gets = 0;
const loaderError = Object.assign(new Error('M1_LOADER_SENTINEL'), { code: 'M1_SENTINEL' });
const rereadError = Object.assign(new Error('M1_CONFIG_REREAD_SENTINEL'), { code: 'M1_SENTINEL' });
globalThis.fetch = async () => { fetchCalls++; throw new Error('M1_FORBIDDEN_NETWORK'); };
const readFile = fsp.readFile, createReadStream = fs.createReadStream, parse = JSON.parse;
function fixturePath(value) {
  try { const path = value instanceof URL ? fileURLToPath(value) : resolve(String(value)); return path.startsWith(input.directory + '/') ? basename(path) : null; } catch { return null; }
}
fsp.readFile = async (...args) => {
  const name = fixturePath(args[0]);
  if (name) trace.push('read:' + name);
  try { return await readFile(...args); } catch (error) { if (name) filesystemError = error; throw error; }
};
fs.createReadStream = (...args) => { const name = fixturePath(args[0]); if (name) trace.push('hash:' + name); return createReadStream(...args); };
JSON.parse = (text, ...args) => {
  const name = text === input.configText ? 'config' : text === input.tokenizerText ? 'tokenizer' : text === fs.readFileSync(input.directory + '/manifest.json', 'utf8') ? 'manifest' : null;
  if (name) trace.push('parse:' + name);
  let value;
  try { value = parse(text, ...args); } catch (error) { if (name) parseError = error; throw error; }
  // Observe the original value, without coercion, validation or synthetic defaults.
  if (name === 'config' && value !== null && typeof value === 'object') {
    const maxTokens = value.max_position_embeddings;
    Object.defineProperty(value, 'max_position_embeddings', { configurable: true, get() {
      trace.push('config:get');
      if (++gets === 2 && input.reread) throw rereadError;
      return maxTokens;
    } });
  }
  return value;
};
syncBuiltinESMExports();
let caught;
try {
  const api = await import(input.moduleURL);
  await (api.transformersAdapterBuilder ? api.transformersAdapterBuilder().warmup : api.createModel)({ directory: pathToFileURL(input.directory + '/'), manifestPath: pathToFileURL(input.directory + '/manifest.json'), loadModel: async (directory, options) => {
    trace.push('loader');
    assert.equal(directory, input.directory + '/');
    assert.deepEqual(options, { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true });
    if (!input.reread) throw loaderError;
    // The public pipeline constructor accepts this synthetic boundary; no model call is allowed.
    return Object.assign(async () => { throw new Error('M1_FORBIDDEN_MODEL_EXECUTION'); }, { config: { id2label: { 0: 'O' } } });
  } });
} catch (error) { caught = error; }
console.log(JSON.stringify({ trace, fetchCalls, error: caught ? { name: caught.name, code: caught.code ?? null, message: caught.message, identity: caught === loaderError ? 'loader' : caught === rereadError ? 'config-reread' : caught === filesystemError ? 'filesystem' : caught === parseError ? 'parse' : null } : null }));
