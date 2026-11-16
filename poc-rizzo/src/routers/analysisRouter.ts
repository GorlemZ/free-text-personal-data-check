import type { IncomingMessage, ServerResponse } from "node:http";
import { apiConverter } from "../model/apiConverter.js";
import type { Analysis } from "../model/contracts.js";
import type { Admission } from "../utilities/admission.js";
import { analyzeRequest } from "../validation/analyzeRequest.js";
import { readPayload, send } from "../utilities/http.js";
import {
  invalidRequest,
  detectorUnavailable,
} from "../utilities/errorMappers.js";
import type { Ready } from "./healthRouter.js";

export async function analysisRouter(
  request: IncomingMessage,
  response: ServerResponse,
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
  const payload = await readPayload(request, response);
  if (!payload.ok) return;
  const fields = analyzeRequest(payload.value);
  if (!fields) return send(response, 400, invalidRequest());
  try {
    const result = await admission.run(async () => {
      if (!(await ready())) throw new Error("detector_unavailable");
      return apiConverter(await analysisService(fields));
    });
    return send(response, 200, result);
  } catch {
    return send(response, 503, detectorUnavailable());
  }
}
