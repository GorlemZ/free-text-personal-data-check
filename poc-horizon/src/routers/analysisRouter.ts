import type { RequestListener } from 'node:http';
import type { AnalysisService } from '../services/analysisService.js';
import type { SerialExecutor } from '../utilities/serialExecutor.js';
import { DetectorUnavailable, InvalidRequest } from '../model/errors.js';
import { toAnalyzeResponse } from '../model/apiConverter.js';
import { toHttpError } from '../utilities/errorMappers.js';
import { readBody, reply } from '../utilities/http.js';
import { validateAnalyzeRequest } from '../validation/analyzeRequest.js';

export function createAnalysisRouter(service: AnalysisService, executor: SerialExecutor): RequestListener {
  return async (req, res) => {
    if ((req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      req.resume();
      const error = toHttpError(new InvalidRequest());
      reply(res, error.status, error.payload);
      return;
    }
    try {
      const fields = validateAnalyzeRequest(await readBody(req));
      const response = await executor.run(async () => toAnalyzeResponse(await service.analyze(fields)))
        .catch(() => { throw new DetectorUnavailable(); });
      reply(res, 200, response);
    } catch (error) {
      const mapped = toHttpError(error);
      reply(res, mapped.status, mapped.payload);
    }
  };
}
