// Preloaded only in an isolated synthetic CLI process; no exception is swallowed.
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
export function observe(input) {
  const trace = [];
  let fetchCalls = 0, parseError, caught;
  const marker = Object.assign(new Error('M1_CLI_FETCH_SENTINEL'), { code: 'M1_SENTINEL' });
  globalThis.fetch = async url => { fetchCalls++; trace.push('fetch:' + url); throw marker; };
  const readFile = fsp.readFile, mkdir = fsp.mkdir, stream = fs.createReadStream, parse = JSON.parse;
  fsp.readFile = async (...args) => { if (args[0] instanceof URL && fileURLToPath(args[0]) === input.directory + '/model-manifest.json') trace.push('read:manifest'); return readFile(...args); };
  fsp.mkdir = async (...args) => { if (args[0] instanceof URL && fileURLToPath(args[0]) === input.directory + '/models/') trace.push('mkdir:models'); return mkdir(...args); };
  fs.createReadStream = (...args) => { if (args[0] instanceof URL && fileURLToPath(args[0]).startsWith(input.directory + '/models/')) trace.push('hash:' + basename(fileURLToPath(args[0]))); return stream(...args); };
  JSON.parse = (text, ...args) => {
    if (text !== input.manifestText) return parse(text, ...args);
    trace.push('parse:manifest');
    let value; try { value = parse(text, ...args); } catch (error) { parseError = error; throw error; }
    // A transparent observer: no members/defaults added, values/coercion unchanged.
    return value !== null && typeof value === 'object' ? new Proxy(value, { get(target, key, receiver) { if (['files','repository','revision'].includes(key)) trace.push('manifest:' + key); return Reflect.get(target,key,receiver); } }) : value;
  };
  syncBuiltinESMExports();
  process.on('uncaughtExceptionMonitor', error => { caught = error; });
  process.on('exit', status => {
    fs.writeFileSync(input.report, JSON.stringify({ trace, fetchCalls, status, modelsExists: fs.existsSync(input.directory + '/models'), error: caught ? {name:caught.name,code:caught.code ?? null,message:caught.message,identity:caught === marker ? 'fetch' : caught === parseError ? 'parse' : null} : null }));
  });
}
