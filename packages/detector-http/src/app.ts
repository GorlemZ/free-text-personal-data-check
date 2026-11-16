import express, { type RequestHandler } from "express";
import type { RequestListener } from "node:http";

export type DetectorRoutes = Readonly<{
  health: RequestListener;
  analyze: RequestListener;
  notFound: RequestListener;
}>;

export function createDetectorApp(routes: DetectorRoutes): RequestListener {
  const app = express();
  app.disable("x-powered-by");
  app.set("strict routing", true);

  // The public PoC contract treats query-bearing endpoint URLs as unknown routes.
  const exactPath: RequestHandler = (request, _response, next) =>
    request.originalUrl === request.path ? next() : next("route");

  app.head("*", (request, response) => routes.notFound(request, response));
  app.get("/health/ready", exactPath, (request, response) =>
    routes.health(request, response),
  );
  app.post("/v1/analyze", exactPath, (request, response) =>
    routes.analyze(request, response),
  );
  app.use((request, response) => routes.notFound(request, response));
  return app;
}
