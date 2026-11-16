import type { IncomingMessage, ServerResponse } from 'node:http';
import getRawBody from 'raw-body';
import { invalidRequest, bodyTooLarge } from './errorMappers.js';

const maxBodyBytes = 1024 * 1024;

export function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify(body));
}

export async function readPayload(request: IncomingMessage, response: ServerResponse): Promise<{ readonly ok: true; readonly value: unknown } | { readonly ok: false }> {
  if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') { request.resume(); send(response, 400, invalidRequest()); return { ok: false }; }
  try {
    // Actual byte count retains the existing precedence, independently of Content-Length.
    const body = await getRawBody(request, { limit: maxBodyBytes });
    const value: unknown = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(body));
    return { ok: true, value };
  } catch (error) {
    request.resume();
    if (error !== null && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
      response.setHeader('connection', 'close');
      send(response, 413, bodyTooLarge());
    } else send(response, 400, invalidRequest());
    return { ok: false };
  }
}
