import type { ServerResponse } from 'node:http';
import { send } from '../utilities/http.js';
import { detectorUnavailable } from '../utilities/errorMappers.js';

export type Ready = () => unknown | Promise<unknown>;
export async function healthRouter(response: ServerResponse, ready: Ready): Promise<void> {
  try { if (await ready()) return send(response, 200, { status: 'ready' }); } catch {}
  return send(response, 503, detectorUnavailable());
}
