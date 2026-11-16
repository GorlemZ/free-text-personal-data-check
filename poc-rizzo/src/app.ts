import { createDetectorApp } from "@pagopa/detector-http";
import type { RequestListener } from "node:http";
import { analysisRouter } from "./routers/analysisRouter.js";
import type { Analysis } from "./model/contracts.js";
import { healthRouter, type Ready } from "./routers/healthRouter.js";
import { send } from "./utilities/http.js";
import { notFound } from "./utilities/errorMappers.js";
import { createAdmission } from "./utilities/admission.js";

export interface AppDependencies {
  readonly analysisService: Analysis;
  readonly ready: Ready;
  readonly concurrency?: number;
}
export function createApp({
  analysisService,
  ready,
  concurrency,
}: AppDependencies): RequestListener {
  const admission = createAdmission(concurrency);
  return createDetectorApp({
    health: (_request, response) => healthRouter(response, ready),
    analyze: (request, response) =>
      analysisRouter(request, response, {
        analysisService,
        ready,
        admission,
      }),
    notFound: (_request, response) => send(response, 404, notFound()),
  });
}
