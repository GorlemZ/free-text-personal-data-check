import { createDetectorApp } from "@pagopa/detector-http";
import type { ErrorRequestHandler } from "express";
import type { RequestListener } from "node:http";
import { analysisRouter } from "./routers/analysisRouter.js";
import type { Analysis } from "./model/contracts.js";
import { healthRouter, type Ready } from "./routers/healthRouter.js";
import { HTTP_LIMITS } from "./config/config.js";
import {
  bodyTooLarge,
  invalidRequest,
  notFound,
} from "./utilities/errorMappers.js";
import { createAdmission } from "./utilities/admission.js";

export interface AppDependencies {
  readonly analysisService: Analysis;
  readonly ready: Ready;
  readonly concurrency?: number;
  readonly maxPendingRequests?: number;
  readonly maxQueueWaitMs?: number;
}

const onJsonError: ErrorRequestHandler = (error, _request, response, next) => {
  void next;
  const status =
    error instanceof Error &&
    "type" in error &&
    error.type === "entity.too.large"
      ? 413
      : 400;
  response
    .status(status)
    .send(status === 413 ? bodyTooLarge() : invalidRequest());
};

export function createApp({
  analysisService,
  ready,
  concurrency,
  maxPendingRequests,
  maxQueueWaitMs,
}: AppDependencies): RequestListener {
  const admission = createAdmission(
    concurrency,
    maxPendingRequests,
    maxQueueWaitMs,
  );
  return createDetectorApp(
    {
      health: (_request, response) => healthRouter(response, ready),
      analyze: (request, response) =>
        analysisRouter(request, response, {
          analysisService,
          ready,
          admission,
        }),
      notFound: (_request, response) => response.status(404).send(notFound()),
    },
    { jsonBodyLimitBytes: HTTP_LIMITS.maxBodyBytes, onJsonError },
  );
}
