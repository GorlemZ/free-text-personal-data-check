import { createServer, type RequestListener, type Server } from "node:http";

export type ServerConfig = Readonly<{
  port: number;
  host: string;
  requestTimeout?: number;
  shutdownTimeout?: number;
}>;

export type ServerLifecycle = Readonly<{
  onError(error: unknown): void;
  onShutdownComplete(): void;
  onShutdownTimeout(): void;
}>;

const defaultLifecycle: ServerLifecycle = {
  onError: () => undefined,
  onShutdownComplete: () => undefined,
  onShutdownTimeout: () => undefined,
};

export async function startServer(
  listener: RequestListener,
  config: ServerConfig,
  lifecycle: ServerLifecycle = defaultLifecycle,
): Promise<Server> {
  const server = createServer(listener);
  if (config.requestTimeout !== undefined)
    server.requestTimeout = config.requestTimeout;

  await new Promise<void>((resolve, reject) => {
    const startupError = (error: Error): void => reject(error);
    server.once("error", startupError);
    server.once("listening", () => {
      server.off("error", startupError);
      resolve();
    });
    server.listen(config.port, config.host);
  });

  server.on("error", lifecycle.onError);
  let shuttingDown = false;
  let timedOut = false;
  const shutdown = (): void => {
    if (shuttingDown) return;
    shuttingDown = true;
    const timeout = setTimeout(() => {
      timedOut = true;
      server.closeAllConnections();
      lifecycle.onShutdownTimeout();
    }, config.shutdownTimeout ?? 10_000);
    timeout.unref();
    server.close(() => {
      clearTimeout(timeout);
      if (!timedOut) lifecycle.onShutdownComplete();
    });
  };
  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);
  server.once("close", () => {
    process.off("SIGTERM", shutdown);
    process.off("SIGINT", shutdown);
  });
  return server;
}
