import { type ErrorRequestHandler, type RequestHandler } from "express";
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
export declare function createDetectorApp(routes: DetectorRoutes, options?: DetectorAppOptions): RequestListener;
