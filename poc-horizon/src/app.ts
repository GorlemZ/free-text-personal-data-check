import { createDetectorApp } from "@pagopa/detector-http";
import type { RequestListener } from "node:http";
import type { AnalysisService } from "./services/analysisService.js";
import type { Readiness } from "./model/contracts.js";
import { createAnalysisRouter } from "./routers/analysisRouter.js";
import { createHealthRouter } from "./routers/healthRouter.js";
import { createAdmission } from "./utilities/admission.js";
import { reply } from "./utilities/http.js";

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
  return createDetectorApp({
    health,
    analyze: analysis,
    notFound: (_req, res) => reply(res, 404, { code: "not_found" }),
  });
}
