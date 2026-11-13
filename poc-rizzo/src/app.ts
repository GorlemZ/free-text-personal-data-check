import type { RequestListener } from 'node:http';
import { analysisRouter } from './routers/analysisRouter.js';
import type { Analysis } from './model/contracts.js';
import { healthRouter, type Ready } from './routers/healthRouter.js';
import { send } from './utilities/http.js';
import { notFound } from './utilities/errorMappers.js';

export interface AppDependencies { readonly analysisService: Analysis; readonly ready: Ready }
export function createApp({ analysisService, ready }: AppDependencies): RequestListener {
  return async (request, response) => {
    if (request.method === 'GET' && request.url === '/health/ready') return healthRouter(response, ready);
    if (request.method === 'POST' && request.url === '/v1/analyze') return analysisRouter(request, response, { analysisService, ready });
    return send(response, 404, notFound());
  };
}
