import { readFile, mkdir, rename, rm } from 'node:fs/promises';
import { createWriteStream, createReadStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { Readable, Transform } from 'node:stream';
import type { ReadableStream } from 'node:stream/web';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export async function prefetch(): Promise<void> {
  const root = new URL('../../models/', import.meta.url);
  // Type-only boundary: missing/primitive members retain their legacy JS behavior.
  const manifest = JSON.parse(await readFile(new URL('../../model-manifest.json', import.meta.url), 'utf8')) as { files: Record<string, unknown>; repository: unknown; revision: unknown };
  await mkdir(root, { recursive: true });
  async function hash(path: URL): Promise<string> { const h=createHash('sha256'); for await(const chunk of createReadStream(path)) h.update(chunk); return h.digest('hex'); }
  const files: readonly [string, unknown][] = Object.entries(manifest.files);
  for (const [name, expected] of files) {
    const file = new URL(name, root);
    try { if (await hash(file) === expected) { console.log(`${name}: verified existing`); continue; } } catch {}
    const url=`https://huggingface.co/${manifest.repository}/resolve/${manifest.revision}/${name}`;
    const response=await fetch(url, {signal: AbortSignal.timeout(1200000)});
    if (!response.ok || !response.body) throw new Error(`MODEL_DOWNLOAD_FAILED ${response.status}`);
    console.log(`${name}: downloading ${response.headers.get('content-length') ?? 'unknown'} bytes`);
    const temporary=fileURLToPath(file)+'.part';
    const digest=createHash('sha256');
    try {
      await pipeline(Readable.fromWeb(response.body as ReadableStream<Uint8Array>),new Transform({transform(chunk,encoding,callback){digest.update(chunk);callback(null,chunk);}}),createWriteStream(temporary));
      if(digest.digest('hex')!==expected) throw new Error(`MODEL_CHECKSUM_FAILED ${name}`);
      await rename(temporary,file);
    } catch(e) {await rm(temporary,{force:true});throw e;}
    console.log(`${name}: verified`);
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await prefetch();
