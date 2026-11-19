import { startServer } from "./http/server.js";
import { createApp } from "./app.js";
import { bardsAiAdapterBuilder } from "./bardsai/model.js";
import { loadConfig, HTTP_LIMITS } from "./config/config.js";
import { analysisServiceBuilder } from "./analysis.js";

try {
  const config = loadConfig(process.env);
  const model = await bardsAiAdapterBuilder({
    tokenBudget: config.tokenBudget,
  });
  const analysisService = analysisServiceBuilder({ model });
  await startServer(
    createApp({
      analysisService,
      ready: () => true,
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
