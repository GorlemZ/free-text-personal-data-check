import { startServer } from "@pagopa/detector-http";
import { createApp } from "./app.js";
import { analysisServiceBuilder } from "./services/analysisService.js";
import { modelDetectionServiceBuilder } from "./services/modelDetectionService.js";
import { transformersAdapterBuilder } from "./adapters/transformersAdapter.js";
import { recognize } from "./recognizers/rules.js";
import { readHttpConfig } from "./config/config.js";

try {
  const config = readHttpConfig(process.env);
  const adapter = await transformersAdapterBuilder({
    tokenBudget: config.tokenBudget,
  });
  const modelDetectionService = modelDetectionServiceBuilder({
    infer: adapter.infer,
  });
  const analysisService = analysisServiceBuilder({
    modelDetectionService,
    ruleDetectionService: recognize,
  });
  await startServer(
    createApp({
      analysisService,
      ready: adapter.ready,
      concurrency: config.concurrency,
      maxPendingRequests: config.maxPendingRequests,
      maxQueueWaitMs: config.maxQueueWaitMs,
    }),
    { port: config.port, host: config.host },
    {
      onError: () => {
        process.stderr.write("SERVER_UNAVAILABLE\n");
        process.exitCode = 1;
      },
      onShutdownComplete: () => {
        process.exitCode = 0;
      },
      onShutdownTimeout: () => {
        process.stderr.write("SERVER_UNAVAILABLE\n");
        process.exitCode = 1;
      },
    },
  );
} catch {
  process.stderr.write("STARTUP_FAILED\n");
  process.exitCode = 1;
}
