import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

// Stable local assets, independent of cwd and source/dist directory layout.
export const MODEL_CONFIG = Object.freeze({
  modelId: 'Horizon-Labs/pii-redactor-base',
  policyVersion: 'horizon-pii-redactor-base-q8-ef0eff8e-poc7-uniform9',
  root: resolve(fileURLToPath(new URL('../../models/', import.meta.url))),
  manifestUrl: new URL('../../model-manifest.json', import.meta.url),
  tokenBudget: 512,
  task: 'token-classification',
  options: Object.freeze({ dtype: 'q8', device: 'cpu', local_files_only: true }),
  tokenizerOptions: Object.freeze({ truncation: false, padding: false }),
  inferenceOptions: Object.freeze({ aggregation_strategy: 'simple' }),
} as const);

export const HTTP_LIMITS = Object.freeze({
  maxBodyBytes: 1048576,
  maxFields: 10,
  maxFieldIdUnits: 128,
  maxWords: 50,
  maxPending: 4,
  requestTimeout: 10000,
});

export type HttpConfig = Readonly<{ port: number; bindHost: string }>;

// Read once at the composition root, never at import or during requests.
export function loadConfig(environment: Readonly<NodeJS.ProcessEnv>): HttpConfig {
  return {
    port: Number(environment.ANALYZER_PORT ?? 8000),
    bindHost: environment.ANALYZER_BIND_HOST ?? '127.0.0.1',
  };
}
