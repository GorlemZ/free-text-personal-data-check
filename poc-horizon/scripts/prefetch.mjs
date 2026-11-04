import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import manifest from '../model-manifest.json' with { type: 'json' };

const root = new URL('../models/', import.meta.url).pathname;
const remote = `https://huggingface.co/${manifest.model}/resolve/${manifest.revision}/`;

async function verify(path, entry) {
  try {
    if ((await stat(path)).size !== entry.size) return false;
    if (!entry.sha256) return true; // Small Git blobs are pinned by revision and checked by size.
    const sha = createHash('sha256');
    for await (const chunk of createReadStream(path)) sha.update(chunk);
    return sha.digest('hex') === entry.sha256;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
for (const entry of manifest.files) {
  const destination = join(root, manifest.model, entry.path);
  if (await verify(destination, entry)) { console.log(`cached ${entry.path}`); continue; }
  if (process.argv.includes('--verify-only')) throw new Error(`missing or corrupt artifact: ${entry.path}`);
  await mkdir(dirname(destination), { recursive: true });
  const temporary = `${destination}.partial`;
  try {
    const response = await fetch(remote + entry.path);
    if (!response.ok || !response.body) throw new Error(`download failed for ${entry.path}: ${response.status}`);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(temporary));
    if (!await verify(temporary, entry)) throw new Error(`artifact verification failed: ${entry.path}`);
    await rename(temporary, destination);
    console.log(`verified ${entry.path} (${entry.size} bytes)`);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}
