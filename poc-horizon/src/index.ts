import { createServer } from "node:http";
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
  const server = createServer(
    createApp({
      analysisService,
      ready: adapter.ready,
      concurrency: config.concurrency,
    }),
  );
  server.requestTimeout = HTTP_LIMITS.requestTimeout;
  server.on("error", () => {
    process.stderr.write("detector_unavailable\n");
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
    server.listen(config.port, config.bindHost);
  });
} catch {
  process.stderr.write("detector_unavailable\n");
  process.exitCode = 1;
}
