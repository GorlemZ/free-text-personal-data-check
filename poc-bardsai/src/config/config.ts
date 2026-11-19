import { fileURLToPath } from "node:url";
import { parsePort } from "@pagopa/detector-http";

// Stable local assets, independent of cwd and source/dist directory layout.
export const MODEL_CONFIG = Object.freeze({
  modelId: "bardsai/eu-pii-anonimization-multilang-v2",
  revision: "07a9a69b0d75c551f5f9450b290f864bfc7dfb51",
  policyVersion: "bardsai-eu-pii-anonimization-multilang-v2-q8-07a9a69b",
  root: fileURLToPath(new URL("../../models/", import.meta.url)),
  manifestUrl: new URL("../../model-manifest.json", import.meta.url),
  tokenBudget: 512,
  task: "token-classification",
  options: Object.freeze({
    dtype: "q8",
    device: "cpu",
    local_files_only: true,
    revision: "07a9a69b0d75c551f5f9450b290f864bfc7dfb51",
    session_options: Object.freeze({
      intraOpNumThreads: 1,
      interOpNumThreads: 1,
    }),
  }),
  tokenizerOptions: Object.freeze({
    local_files_only: true,
    revision: "07a9a69b0d75c551f5f9450b290f864bfc7dfb51",
  }),
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
  maxPendingRequests: number;
  maxQueueWaitMs: number;
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

function nonNegativeInteger(
  value: string | undefined,
  fallback: number,
  name: string,
): number {
  if (value !== undefined && value.trim() === "")
    throw new TypeError("INVALID_" + name);
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0)
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
      2,
      "CONCURRENCY",
    ),
    maxPendingRequests: nonNegativeInteger(
      environment.ANALYZER_MAX_PENDING_REQUESTS,
      4,
      "MAX_PENDING_REQUESTS",
    ),
    maxQueueWaitMs: positiveInteger(
      environment.ANALYZER_MAX_QUEUE_WAIT_MS,
      500,
      "MAX_QUEUE_WAIT_MS",
    ),
    tokenBudget,
  };
}
