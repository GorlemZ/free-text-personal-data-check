import type { RequestListener } from 'node:http';
import type { AnalysisService } from './services/analysisService.js';
import type { Readiness } from './model/contracts.js';
import { createAnalysisRouter } from './routers/analysisRouter.js';
import { createHealthRouter } from './routers/healthRouter.js';
import { createSerialExecutor } from './utilities/serialExecutor.js';
import { reply } from './utilities/http.js';

export type AppDependencies = Readonly<{
  analysisService: AnalysisService;
  ready: Readiness;
  onQueued?: (pending: number) => void;
}>;

export function createApp(deps: AppDependencies): RequestListener {
  if (!deps || typeof deps.analysisService?.analyze !== 'function' || typeof deps.ready !== 'function')
    throw new TypeError('App dependencies are required');
  const analysis = createAnalysisRouter(deps.analysisService, createSerialExecutor(deps.onQueued));
  const health = createHealthRouter(deps.ready);
  return (req, res) => {
    if (req.method === 'GET' && req.url === '/health/ready') return health(req, res);
    if (req.method === 'POST' && req.url === '/v1/analyze') return analysis(req, res);
    reply(res, 404, { code: 'not_found' });
  };
}
