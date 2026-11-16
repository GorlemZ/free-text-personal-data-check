import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { transformersAdapterBuilder } from './adapters/transformersAdapter.js';
import { loadConfig, HTTP_LIMITS } from './config/config.js';
import { analysisServiceBuilder } from './services/analysisService.js';

export async function main(): Promise<void> {
  try {
    const config = loadConfig(process.env);
    const adapter = await transformersAdapterBuilder({ tokenBudget: config.tokenBudget });
    const analysisService = analysisServiceBuilder({ adapter });
    const server = createServer(createApp({ analysisService, ready: adapter.ready, concurrency: config.concurrency }));
    server.requestTimeout = HTTP_LIMITS.requestTimeout;
    server.listen(config.port, config.bindHost);
  } catch {
    console.error('detector_unavailable');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
