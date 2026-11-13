import type { IncomingMessage, ServerResponse } from 'node:http';
import { HTTP_LIMITS } from '../config/config.js';
import { BodyTooLarge, InvalidRequest } from '../model/errors.js';

export function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
export async function readBody(req: IncomingMessage): Promise<string> {
  let size = 0;
  const chunks: Buffer[] = [];
  try {
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > HTTP_LIMITS.maxBodyBytes) throw new BodyTooLarge();
      chunks.push(chunk);
    }
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks));
  } catch (error) {
    req.resume();
    if (error instanceof BodyTooLarge) throw error;
    throw new InvalidRequest();
  }
}
