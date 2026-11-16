import type { IncomingMessage, ServerResponse } from 'node:http';
import getRawBody from 'raw-body';
import { HTTP_LIMITS } from '../config/config.js';
import { BodyTooLarge, InvalidRequest } from '../model/errors.js';

export function reply(res: ServerResponse, status: number, payload: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
export async function readBody(req: IncomingMessage): Promise<string> {
  try {
    // Count actual bytes, not Content-Length: preserve body/error precedence.
    // Buffering state belongs to raw-body; decoding remains fatal and preserves BOM.
    const body = await getRawBody(req, { limit: HTTP_LIMITS.maxBodyBytes });
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body);
  } catch (error) {
    req.resume();
    if (error !== null && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') throw new BodyTooLarge();
    throw new InvalidRequest();
  }
}
