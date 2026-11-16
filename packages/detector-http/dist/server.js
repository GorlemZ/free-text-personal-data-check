import { createServer } from "node:http";
const defaultLifecycle = {
    onError: () => undefined,
    onShutdownComplete: () => undefined,
    onShutdownTimeout: () => undefined,
};
export async function startServer(listener, config, lifecycle = defaultLifecycle) {
    const server = createServer(listener);
    if (config.requestTimeout !== undefined)
        server.requestTimeout = config.requestTimeout;
    await new Promise((resolve, reject) => {
        const startupError = (error) => reject(error);
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
    const shutdown = () => {
        if (shuttingDown)
            return;
        shuttingDown = true;
        const timeout = setTimeout(() => {
            timedOut = true;
            server.closeAllConnections();
            lifecycle.onShutdownTimeout();
        }, config.shutdownTimeout ?? 10_000);
        timeout.unref();
        server.close(() => {
            clearTimeout(timeout);
            if (!timedOut)
                lifecycle.onShutdownComplete();
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
