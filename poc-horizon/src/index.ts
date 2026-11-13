import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createApp } from './app.js';
import { transformersAdapterBuilder } from './adapters/transformersAdapter.js';
import { loadConfig, HTTP_LIMITS } from './config/config.js';
import { analysisServiceBuilder } from './services/analysisService.js';
import { ruleDetectionServiceBuilder } from './services/ruleDetectionService.js';
import { modelDetectionServiceBuilder } from './services/modelDetectionService.js';

export async function main(): Promise<void> {
  try {
    const config = loadConfig(process.env);
    const adapter = transformersAdapterBuilder();
    const ruleDetectionService = ruleDetectionServiceBuilder();
    const modelDetectionService = modelDetectionServiceBuilder(adapter);
    const analysisService = analysisServiceBuilder({ ruleDetectionService, modelDetectionService });
    await modelDetectionService.ready(); // fail before accepting requests
    const server = createServer(createApp({ analysisService, ready: modelDetectionService.ready }));
    server.requestTimeout = HTTP_LIMITS.requestTimeout;
    server.listen(config.port, config.bindHost);
  } catch {
    console.error('detector_unavailable');
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  await main();
