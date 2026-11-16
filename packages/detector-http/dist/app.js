import express from "express";
export function createDetectorApp(routes, options = {}) {
    const app = express();
    app.disable("x-powered-by");
    app.set("strict routing", true);
    if (options.noSniff === true)
        app.use((_request, response, next) => {
            response.set("X-Content-Type-Options", "nosniff");
            next();
        });
    // The public PoC contract treats query-bearing endpoint URLs as unknown routes.
    const exactPath = (request, _response, next) => request.originalUrl === request.path ? next() : next("route");
    app.head("*", routes.notFound);
    app.get("/health/ready", exactPath, routes.health);
    const analyzeHandlers = options.jsonBodyLimitBytes === undefined
        ? [routes.analyze]
        : [express.json({ limit: options.jsonBodyLimitBytes }), routes.analyze];
    app.post("/v1/analyze", exactPath, ...analyzeHandlers);
    app.use(routes.notFound);
    if (options.onJsonError !== undefined)
        app.use(options.onJsonError);
    return app;
}
