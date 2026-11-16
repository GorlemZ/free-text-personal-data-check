import { createServer } from "node:http";
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
  const server = createServer(
    createApp({
      analysisService,
      ready: () => true,
      concurrency: config.concurrency,
    }),
  );
  server.on("error", () => {
    process.stderr.write("SERVER_UNAVAILABLE\n");
    process.exitCode = 1;
  });
  const shutdown = (): void => {
    server.close(() => {
      process.exitCode = 0;
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  await new Promise<void>((resolve, reject) => {
    const startupError = (error: Error): void => reject(error);
    server.once("error", startupError);
    server.once("listening", () => {
      server.off("error", startupError);
      resolve();
    });
    server.listen(config.port, config.host);
  });
} catch {
  process.stderr.write("STARTUP_FAILED\n");
  process.exitCode = 1;
}
