import express, {
  type ErrorRequestHandler,
  type RequestHandler,
} from "express";
import type { RequestListener } from "node:http";

export type DetectorRoutes = Readonly<{
  health: RequestHandler;
  analyze: RequestHandler;
  notFound: RequestHandler;
}>;

export type DetectorAppOptions = Readonly<{
  jsonBodyLimitBytes?: number;
  noSniff?: boolean;
  onJsonError?: ErrorRequestHandler;
}>;

export function createDetectorApp(
  routes: DetectorRoutes,
  options: DetectorAppOptions = {},
): RequestListener {
  const app = express();
  app.disable("x-powered-by");
  app.set("strict routing", true);
  if (options.noSniff === true)
    app.use((_request, response, next) => {
      response.set("X-Content-Type-Options", "nosniff");
      next();
    });

  // The public PoC contract treats query-bearing endpoint URLs as unknown routes.
  const exactPath: RequestHandler = (request, _response, next) =>
    request.originalUrl === request.path ? next() : next("route");

  app.head("*", routes.notFound);
  app.get("/health/ready", exactPath, routes.health);
  const analyzeHandlers: readonly RequestHandler[] =
    options.jsonBodyLimitBytes === undefined
      ? [routes.analyze]
      : [express.json({ limit: options.jsonBodyLimitBytes }), routes.analyze];
  app.post("/v1/analyze", exactPath, ...analyzeHandlers);
  app.use(routes.notFound);
  if (options.onJsonError !== undefined) app.use(options.onJsonError);
  return app;
}
