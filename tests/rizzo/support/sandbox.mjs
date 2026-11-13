import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, realpath, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
export const root = fileURLToPath(new URL('../../../poc-rizzo/', import.meta.url));
export function cleanEnv() {
  const env = { ...process.env, TMPDIR: tmpdir(), TRANSFORMERS_OFFLINE: '1', HF_HUB_OFFLINE: '1' };
  delete env.NODE_OPTIONS;
  delete env.NODE_PATH;
  return env;
}
export async function sandbox(t) {
  const parent = await realpath(tmpdir());
  assert.equal(parent, await realpath(process.env.TMPDIR ?? tmpdir()));
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', 'import{realpathSync}from"node:fs";import{tmpdir}from"node:os";console.log(realpathSync(tmpdir()))'], { encoding: 'utf8', env: cleanEnv() });
  assert.equal(child.status, 0, child.stderr);
  assert.equal(child.stdout.trim(), parent);
  const temporary = await realpath(await mkdtemp(join(parent, 'rizzo-dist-')));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const pkg = join(temporary, 'package');
  const cwd = join(temporary, 'foreign-working-directory');
  await mkdir(pkg);
  await mkdir(cwd);
  await cp(join(root, 'dist'), join(pkg, 'dist'), { recursive: true });
  await cp(join(root, 'package.json'), join(pkg, 'package.json'));
  await mkdir(join(pkg, 'node_modules/@huggingface'), { recursive: true });
  for (const name of ['@huggingface/transformers', 'ibantools']) await symlink(await realpath(join(root, 'node_modules', name)), join(pkg, 'node_modules', name), 'dir');
  return { pkg, cwd };
}
export function child(code, cwd, argv = ['--input-type=module', '-e', code]) {
  const result = spawnSync(process.execPath, argv, { cwd, encoding: 'utf8', env: cleanEnv(), timeout: 20000 });
  assert.ifError(result.error);
  assert.equal(result.signal, null, result.stderr + result.stdout);
  return result;
}
