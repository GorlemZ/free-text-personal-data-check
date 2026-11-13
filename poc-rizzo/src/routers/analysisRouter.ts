import type { IncomingMessage, ServerResponse } from 'node:http';
import { apiConverter } from '../model/apiConverter.js';
import type { Analysis, Finding } from '../model/contracts.js';
import { analyzeRequest } from '../validation/analyzeRequest.js';
import { readPayload, send } from '../utilities/http.js';
import { invalidRequest, detectorUnavailable } from '../utilities/errorMappers.js';
import type { Ready } from './healthRouter.js';

export async function analysisRouter(request: IncomingMessage, response: ServerResponse, { analysisService, ready }: { readonly analysisService: Analysis; readonly ready: Ready }): Promise<void> {
  const payload = await readPayload(request, response);
  if (!payload.ok) return;
  const fields = analyzeRequest(payload.value);
  if (!fields) return send(response, 400, invalidRequest());
  let findings: readonly Finding[];
  try {
    if (!await ready()) throw new Error('detector_unavailable');
    findings = await analysisService(fields);
  } catch { return send(response, 503, detectorUnavailable()); }
  return send(response, 200, apiConverter(findings));
}
