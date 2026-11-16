import { fileURLToPath } from "node:url";
import { parsePort } from "@pagopa/detector-http";

export const HTTP_LIMITS = Object.freeze({
  maxBodyBytes: 1_048_576,
  maxFieldIdUnits: 128,
  maxFields: 10,
  maxWords: 50,
});

export interface HttpConfig {
  readonly port: number;
  readonly host: string;
  readonly concurrency: number;
  readonly maxPendingRequests: number;
  readonly maxQueueWaitMs: number;
  readonly tokenBudget: number;
}
function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new TypeError("INVALID_" + name);
  return parsed;
}
function nonNegativeInteger(value: string, name: string): number {
  if (value.trim() === "") throw new TypeError("INVALID_" + name);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
    throw new TypeError("INVALID_" + name);
  return parsed;
}
export function readHttpConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HttpConfig {
  return {
    port: parsePort(environment.PORT),
    host: environment.BIND_HOST ?? "127.0.0.1",
    concurrency: positiveInteger(
      environment.ANALYZER_CONCURRENCY ?? "2",
      "CONCURRENCY",
    ),
    maxPendingRequests: nonNegativeInteger(
      environment.ANALYZER_MAX_PENDING_REQUESTS ?? "4",
      "MAX_PENDING_REQUESTS",
    ),
    maxQueueWaitMs: positiveInteger(
      environment.ANALYZER_MAX_QUEUE_WAIT_MS ?? "500",
      "MAX_QUEUE_WAIT_MS",
    ),
    tokenBudget: positiveInteger(
      environment.ANALYZER_TOKEN_BUDGET ?? "512",
      "TOKEN_BUDGET",
    ),
  };
}
export const entrypointPath = fileURLToPath(
  new URL("../index.js", import.meta.url),
);
