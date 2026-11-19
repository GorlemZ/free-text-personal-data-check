import type { RequestHandler } from "express";
import type { AnalysisService } from "./analysis.js";
import type { Admission } from "./http/admission.js";
import { DetectorUnavailable } from "./http/errors.js";
import { toAnalyzeResponse } from "./analysis.js";
import { toHttpError } from "./http/errors.js";
import { validateAnalyzeRequest } from "./validation/analyzeRequest.js";

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

import type { Readiness } from "./model/contracts.js";

export function createHealthRouter(ready: Readiness): RequestHandler {
  return async (_req, res) => {
    try {
      if (!(await ready())) throw new DetectorUnavailable();
      res.status(200).send({ status: "ready" });
    } catch {
      const mapped = toHttpError(new DetectorUnavailable());
      res.status(mapped.status).send(mapped.payload);
    }
  };
}
