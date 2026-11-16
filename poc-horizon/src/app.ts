import { createDetectorApp } from "@pagopa/detector-http";
import type { RequestListener } from "node:http";
import type { ErrorRequestHandler } from "express";
import type { AnalysisService } from "./services/analysisService.js";
import type { Readiness } from "./model/contracts.js";
import { createAnalysisRouter } from "./routers/analysisRouter.js";
import { createHealthRouter } from "./routers/healthRouter.js";
import { createAdmission } from "./utilities/admission.js";
import { HTTP_LIMITS } from "./config/config.js";
import { BodyTooLarge, InvalidRequest } from "./model/errors.js";
import { toHttpError } from "./utilities/errorMappers.js";

export type AppDependencies = Readonly<{
  analysisService: AnalysisService;
  ready: Readiness;
  concurrency?: number;
}>;

export function createApp(deps: AppDependencies): RequestListener {
  if (
    !deps ||
    typeof deps.analysisService?.analyze !== "function" ||
    typeof deps.ready !== "function"
  )
    throw new TypeError("App dependencies are required");
  const analysis = createAnalysisRouter(
    deps.analysisService,
    createAdmission(deps.concurrency),
  );
  const health = createHealthRouter(deps.ready);
  const onJsonError: ErrorRequestHandler = (error, _req, res, next) => {
    void next;
    const cause: unknown = error;
    const mapped = toHttpError(
      cause !== null &&
        typeof cause === "object" &&
        "type" in cause &&
        cause.type === "entity.too.large"
        ? new BodyTooLarge()
        : new InvalidRequest(),
    );
    res.status(mapped.status).send(mapped.payload);
  };
  return createDetectorApp(
    {
      health,
      analyze: analysis,
      notFound: (_req, res) => res.status(404).send({ code: "not_found" }),
    },
    {
      jsonBodyLimitBytes: HTTP_LIMITS.maxBodyBytes,
      noSniff: true,
      onJsonError,
    },
  );
}
