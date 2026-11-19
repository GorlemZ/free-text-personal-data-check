import { fileURLToPath } from "node:url";
import { z } from "zod";

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

const integer = (min: number, max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .regex(/^[0-9]+$/)
    .transform(Number)
    .pipe(z.number().int().safe().min(min).max(max));
const envSchema = z.object({
  ANALYZER_PORT: integer(0, 65535).default("8000"),
  ANALYZER_BIND_HOST: z.string().trim().min(1).default("127.0.0.1"),
  ANALYZER_CONCURRENCY: integer(1, Number.MAX_SAFE_INTEGER).default("2"),
  ANALYZER_MAX_PENDING_REQUESTS: integer(0, Number.MAX_SAFE_INTEGER).default(
    "4",
  ),
  ANALYZER_MAX_QUEUE_WAIT_MS: integer(1, 2147483647).default("500"),
  ANALYZER_TOKEN_BUDGET: integer(1, MODEL_CONFIG.tokenBudget).default("512"),
});
export function loadConfig(environment: Readonly<NodeJS.ProcessEnv>) {
  const env = envSchema.parse(environment);
  return {
    port: env.ANALYZER_PORT,
    bindHost: env.ANALYZER_BIND_HOST,
    concurrency: env.ANALYZER_CONCURRENCY,
    maxPendingRequests: env.ANALYZER_MAX_PENDING_REQUESTS,
    maxQueueWaitMs: env.ANALYZER_MAX_QUEUE_WAIT_MS,
    tokenBudget: env.ANALYZER_TOKEN_BUDGET,
  };
}
