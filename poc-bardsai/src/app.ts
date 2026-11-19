import express, { type RequestHandler } from "express";
import type { RequestListener } from "node:http";
import type { ErrorRequestHandler } from "express";
import type { AnalysisService } from "./analysis.js";
import type { Readiness } from "./model/contracts.js";
import { createAnalysisRouter, createHealthRouter } from "./router.js";
import { createAdmission } from "./http/admission.js";
import { HTTP_LIMITS } from "./config/config.js";
import { BodyTooLarge, InvalidRequest } from "./http/errors.js";
import { toHttpError } from "./http/errors.js";

export type AppDependencies = Readonly<{
  analysisService: AnalysisService;
  ready: Readiness;
  concurrency?: number;
  maxPendingRequests?: number;
  maxQueueWaitMs?: number;
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
    createAdmission(
      deps.concurrency,
      deps.maxPendingRequests,
      deps.maxQueueWaitMs,
    ),
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
  const app = express();
  app.disable("x-powered-by");
  app.set("strict routing", true);
  app.use((_request, response, next) => {
    response.set("X-Content-Type-Options", "nosniff");
    next();
  });
  const exactPath: RequestHandler = (request, _response, next) =>
    request.originalUrl === request.path ? next() : next("route");
  const notFound: RequestHandler = (_req, res) => {
    res.status(404).send({ code: "not_found" });
  };
  app.head("*", notFound);
  app.get("/health/ready", exactPath, health);
  app.post(
    "/v1/analyze",
    exactPath,
    express.json({ limit: HTTP_LIMITS.maxBodyBytes }),
    analysis,
  );
  app.use(notFound);
  app.use(onJsonError);
  return app;
}
