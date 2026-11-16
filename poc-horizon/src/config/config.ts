import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parsePort } from "@pagopa/detector-http";

// Stable local assets, independent of cwd and source/dist directory layout.
export const MODEL_CONFIG = Object.freeze({
  modelId: "Horizon-Labs/pii-redactor-base",
  policyVersion: "horizon-pii-redactor-base-q8-ef0eff8e-poc7-uniform9",
  root: resolve(fileURLToPath(new URL("../../models/", import.meta.url))),
  manifestUrl: new URL("../../model-manifest.json", import.meta.url),
  tokenBudget: 512,
  task: "token-classification",
  options: Object.freeze({
    dtype: "q8",
    device: "cpu",
    local_files_only: true,
  }),
  tokenizerOptions: Object.freeze({
    truncation: false,
    padding: false,
    add_special_tokens: true,
  }),
  inferenceOptions: Object.freeze({ aggregation_strategy: "simple" }),
} as const);

export const HTTP_LIMITS = Object.freeze({
  maxBodyBytes: 1048576,
  maxFields: 10,
  maxFieldIdUnits: 128,
  maxWords: 50,

  requestTimeout: 10000,
});

export type HttpConfig = Readonly<{
  port: number;
  bindHost: string;
  concurrency: number;
  tokenBudget: number;
}>;

function positiveInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0)
    throw new TypeError("INVALID_" + name);
  return parsed;
}

// Read once at the composition root, never at import or during requests.
export function loadConfig(
  environment: Readonly<NodeJS.ProcessEnv>,
): HttpConfig {
  const tokenBudget = positiveInteger(
    environment.ANALYZER_TOKEN_BUDGET,
    MODEL_CONFIG.tokenBudget,
    "TOKEN_BUDGET",
  );
  if (tokenBudget > MODEL_CONFIG.tokenBudget)
    throw new TypeError("INVALID_TOKEN_BUDGET");
  return {
    port: parsePort(environment.ANALYZER_PORT),
    bindHost: environment.ANALYZER_BIND_HOST ?? "127.0.0.1",
    concurrency: positiveInteger(
      environment.ANALYZER_CONCURRENCY,
      1,
      "CONCURRENCY",
    ),
    tokenBudget,
  };
}
