import { fileURLToPath } from "node:url";

export interface HttpConfig {
  readonly port: number;
  readonly host: string;
  readonly concurrency: number;
  readonly tokenBudget: number;
}
function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new TypeError("INVALID_" + name);
  return parsed;
}
export function readHttpConfig(
  environment: NodeJS.ProcessEnv = process.env,
): HttpConfig {
  return {
    port: Number(environment.PORT ?? 8000),
    host: environment.BIND_HOST ?? "127.0.0.1",
    concurrency: positiveInteger(
      environment.ANALYZER_CONCURRENCY ?? "1",
      "CONCURRENCY",
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
