import { fileURLToPath } from 'node:url';

export interface HttpConfig { readonly port: number; readonly host: string }
export function readHttpConfig(environment: NodeJS.ProcessEnv = process.env): HttpConfig {
  return { port: Number(environment.PORT ?? 8000), host: environment.BIND_HOST ?? '127.0.0.1' };
}
export const entrypointPath = fileURLToPath(new URL('../index.js', import.meta.url));
