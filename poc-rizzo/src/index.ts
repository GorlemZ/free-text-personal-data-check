import { resolve } from 'node:path';
import { createServer as createHttpServer, type RequestListener, type Server } from 'node:http';
import { createApp } from './app.js';
import { analysisServiceBuilder } from './services/analysisService.js';
import { modelDetectionServiceBuilder } from './services/modelDetectionService.js';
import { transformersAdapterBuilder } from './adapters/transformersAdapter.js';
import type { Analysis } from './model/contracts.js';
import { entrypointPath, readHttpConfig, type HttpConfig } from './config/config.js';
import type { ModelOptions } from './config/modelConfig.js';
export { analysisServiceBuilder, transformersAdapterBuilder };

interface StartupDependencies {
  readonly warmup: () => Promise<Analysis>;
  readonly createServer?: (listener: RequestListener) => Server;
  readonly config?: HttpConfig;
  readonly onServerError?: () => void;
}
const serverUnavailable = (): void => { process.stderr.write('SERVER_UNAVAILABLE\n'); process.exit(1); };

export async function startup({ warmup, createServer = createHttpServer, config, onServerError = serverUnavailable }: StartupDependencies): Promise<Server> {
  const httpConfig = config ?? readHttpConfig();
  const analysisService = await warmup();
  const server = createServer(createApp({ analysisService, ready: () => true, concurrency: httpConfig.concurrency ?? 1 }));
  server.on('error', onServerError);
  const { port, host } = httpConfig;
  server.listen(port, host);
  return server;
}

export async function composeRuntime(options: ModelOptions = {}) {
  const { recognize } = await import('./recognizers/rules.js');
  const adapter = await transformersAdapterBuilder(options);
  const modelDetectionService = modelDetectionServiceBuilder({ infer: adapter.infer });
  const ruleDetectionService = recognize;
  const analysisService = analysisServiceBuilder({ modelDetectionService, ruleDetectionService });
  return { adapter, modelDetectionService, analysisService };
}

export async function main(): Promise<void> {
  try {
    const config = readHttpConfig();
    const { analysisService } = await composeRuntime(config);
    const server = await startup({ config, warmup: async () => analysisService });
    process.once('SIGTERM', () => server.close(() => process.exit(0)));
    process.once('SIGINT', () => server.close(() => process.exit(0)));
  } catch { process.stderr.write('STARTUP_FAILED\n'); process.exit(1); }
}
if (process.argv[1] && resolve(process.argv[1]) === entrypointPath) await main();
