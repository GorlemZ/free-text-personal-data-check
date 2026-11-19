import type { RequestHandler } from "express";
import type { AnalysisService } from "../services/analysisService.js";
import type { Admission } from "../utilities/admission.js";
import { DetectorUnavailable } from "../model/errors.js";
import { toAnalyzeResponse } from "../model/apiConverter.js";
import { toHttpError } from "../utilities/errorMappers.js";
import { validateAnalyzeRequest } from "../validation/analyzeRequest.js";

export function createAnalysisRouter(
  service: AnalysisService,
  executor: Admission,
): RequestHandler {
  return async (req, res) => {
    try {
      const body: unknown = req.body;
      const fields = validateAnalyzeRequest(body);
      const response = await executor
        .run(async () => toAnalyzeResponse(await service.analyze(fields)))
        .catch(() => {
          throw new DetectorUnavailable();
        });
      res.status(200).send(response);
    } catch (error) {
      const mapped = toHttpError(error);
      res.status(mapped.status).send(mapped.payload);
    }
  };
}
