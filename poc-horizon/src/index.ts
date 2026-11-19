import { startServer } from "@pagopa/detector-http";
import { createApp } from "./app.js";
import { transformersAdapterBuilder } from "./adapters/transformersAdapter.js";
import { loadConfig, HTTP_LIMITS } from "./config/config.js";
import { analysisServiceBuilder } from "./services/analysisService.js";

try {
  const config = loadConfig(process.env);
  const adapter = await transformersAdapterBuilder({
    tokenBudget: config.tokenBudget,
  });
  const analysisService = analysisServiceBuilder({ adapter });
  await startServer(
    createApp({
      analysisService,
      ready: adapter.ready,
      concurrency: config.concurrency,
      maxPendingRequests: config.maxPendingRequests,
      maxQueueWaitMs: config.maxQueueWaitMs,
    }),
    {
      port: config.port,
      host: config.bindHost,
      requestTimeout: HTTP_LIMITS.requestTimeout,
    },
    {
      onError: () => {
        process.stderr.write("detector_unavailable\n");
        process.exitCode = 1;
      },
      onShutdownComplete: () => {
        process.exitCode = 0;
      },
      onShutdownTimeout: () => {
        process.stderr.write("detector_unavailable\n");
        process.exitCode = 1;
      },
    },
  );
} catch {
  process.stderr.write("detector_unavailable\n");
  process.exitCode = 1;
}
