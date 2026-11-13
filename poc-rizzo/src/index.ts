import { resolve } from 'node:path';
import { createServer as createHttpServer, type RequestListener, type Server } from 'node:http';
import { createApp } from './app.js';
import { analysisServiceBuilder } from './services/analysisService.js';
import { modelDetectionServiceBuilder } from './services/modelDetectionService.js';
import { transformersAdapterBuilder } from './adapters/transformersAdapter.js';
import type { Analysis } from './model/contracts.js';
import { entrypointPath, readHttpConfig, type HttpConfig } from './config/config.js';
export { analysisServiceBuilder, transformersAdapterBuilder };

interface StartupDependencies {
  readonly warmup: () => Promise<Analysis>;
  readonly createServer?: (listener: RequestListener) => Server;
  readonly config?: HttpConfig;
  readonly onServerError?: () => void;
}
const serverUnavailable = (): void => { process.stderr.write('SERVER_UNAVAILABLE\n'); process.exit(1); };

export async function startup({ warmup, createServer = createHttpServer, config, onServerError = serverUnavailable }: StartupDependencies): Promise<Server> {
  const analysisService = await warmup();
  const server = createServer(createApp({ analysisService, ready: () => true }));
  server.on('error', onServerError);
  const { port, host } = config ?? readHttpConfig();
  server.listen(port, host);
  return server;
}

export async function composeRuntime() {
  const { ruleDetectionServiceBuilder } = await import('./services/ruleDetectionService.js');
  const adapter = transformersAdapterBuilder();
  const modelDetectionService = modelDetectionServiceBuilder({ infer: adapter.infer });
  const ruleDetectionService = ruleDetectionServiceBuilder();
  const analysisService = analysisServiceBuilder({ modelDetectionService, ruleDetectionService });
  return { adapter, modelDetectionService, analysisService };
}

export async function main(): Promise<void> {
  try {
    const { adapter, analysisService } = await composeRuntime();
    const server = await startup({ warmup: async () => { await adapter.warmup(); return analysisService; } });
    process.once('SIGTERM', () => server.close(() => process.exit(0)));
    process.once('SIGINT', () => server.close(() => process.exit(0)));
  } catch { process.stderr.write('STARTUP_FAILED\n'); process.exit(1); }
}
if (process.argv[1] && resolve(process.argv[1]) === entrypointPath) await main();
