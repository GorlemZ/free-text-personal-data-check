import { type RequestListener, type Server } from "node:http";
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
export declare function startServer(listener: RequestListener, config: ServerConfig, lifecycle?: ServerLifecycle): Promise<Server>;
