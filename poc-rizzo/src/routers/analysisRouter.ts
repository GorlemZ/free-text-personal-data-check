import type { Request, Response } from "express";
import { apiConverter } from "../model/apiConverter.js";
import type { Analysis } from "../model/contracts.js";
import type { Admission } from "../utilities/admission.js";
import { analyzeRequest } from "../validation/analyzeRequest.js";
import {
  invalidRequest,
  detectorUnavailable,
} from "../utilities/errorMappers.js";
import type { Ready } from "./healthRouter.js";

export async function analysisRouter(
  request: Request,
  response: Response,
  {
    analysisService,
    ready,
    admission,
  }: {
    readonly analysisService: Analysis;
    readonly ready: Ready;
    readonly admission: Admission;
  },
): Promise<void> {
  const fields = analyzeRequest(request.body);
  if (!fields) {
    response.status(400).send(invalidRequest());
    return;
  }
  try {
    const result = await admission.run(async () => {
      if (!(await ready())) throw new Error("detector_unavailable");
      return apiConverter(await analysisService(fields));
    });
    response.status(200).send(result);
  } catch {
    response.status(503).send(detectorUnavailable());
  }
}
