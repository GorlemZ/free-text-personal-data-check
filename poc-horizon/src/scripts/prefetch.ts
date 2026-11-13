import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, rm, stat } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream } from 'node:stream/web';
import { MODEL_CONFIG } from '../config/config.js';

type ManifestEntry = Readonly<{ path: string; size: number; sha256?: string }>;
type Manifest = Readonly<{ model: string; revision: string; files: readonly ManifestEntry[] }>;

const root = MODEL_CONFIG.root;
const manifestUrl = MODEL_CONFIG.manifestUrl;

async function verify(path: string, entry: ManifestEntry): Promise<boolean> {
  try {
    if ((await stat(path)).size !== entry.size) return false;
    if (!entry.sha256) return true; // Small Git blobs are pinned by revision and checked by size.
    const sha = createHash('sha256');
    for await (const chunk of createReadStream(path)) sha.update(chunk);
    return sha.digest('hex') === entry.sha256;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false;
    throw error;
  }
}

export async function prefetch({ verifyOnly = false }: Readonly<{ verifyOnly?: boolean }> = {}): Promise<void> {
  const manifest: Manifest = JSON.parse(await readFile(manifestUrl, 'utf8'));
  const remote = `https://huggingface.co/${manifest.model}/resolve/${manifest.revision}/`;
  for (const entry of manifest.files) {
    const destination = join(root, manifest.model, entry.path);
    if (await verify(destination, entry)) { console.log(`cached ${entry.path}`); continue; }
    if (verifyOnly) throw new Error(`missing or corrupt artifact: ${entry.path}`);
    await mkdir(dirname(destination), { recursive: true });
    const temporary = `${destination}.partial`;
    try {
      const response = await fetch(remote + entry.path);
      if (!response.ok || !response.body) throw new Error(`download failed for ${entry.path}: ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>), createWriteStream(temporary));
      if (!await verify(temporary, entry)) throw new Error(`artifact verification failed: ${entry.path}`);
      await rename(temporary, destination);
      console.log(`verified ${entry.path} (${entry.size} bytes)`);
    } catch (error) {
      await rm(temporary, { force: true });
      throw error;
    }
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await prefetch({ verifyOnly: process.argv.includes('--verify-only') });
