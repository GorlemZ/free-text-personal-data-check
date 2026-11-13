import type { IncomingMessage, ServerResponse } from 'node:http';
import { parseUniqueJSON } from '../validation/strictJson.js';
import { invalidRequest, bodyTooLarge } from './errorMappers.js';

export function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export async function readPayload(request: IncomingMessage, response: ServerResponse): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') { request.resume(); send(response, 400, invalidRequest()); return { ok: false }; }
  const chunks: Buffer[] = [];
  let size = 0;
  let payload: unknown;
  try {
    for await (const chunk of request.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 1024 * 1024) {
        request.resume();
        response.setHeader('connection', 'close');
        send(response, 413, bodyTooLarge());
        return { ok: false };
      }
      chunks.push(chunk);
    }
    payload = parseUniqueJSON(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
  } catch { send(response, 400, invalidRequest()); return { ok: false }; }
  return { ok: true, value: payload };
}
