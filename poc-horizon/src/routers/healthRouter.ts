import type { RequestListener } from 'node:http';
import type { Readiness } from '../model/contracts.js';
import { DetectorUnavailable } from '../model/errors.js';
import { reply } from '../utilities/http.js';
import { toHttpError } from '../utilities/errorMappers.js';

export function createHealthRouter(ready: Readiness): RequestListener {
  return async (_req, res) => {
    try { await ready(); reply(res, 200, { status: 'ready' }); }
    catch {
      const mapped = toHttpError(new DetectorUnavailable());
      reply(res, mapped.status, mapped.payload);
    }
  };
}
