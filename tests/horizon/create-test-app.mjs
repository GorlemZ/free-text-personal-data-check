// Fixture-only compatibility adapter: HTTP + real current analysis, never a mock service.
import { createApp } from '../../poc-horizon/dist/app.js';
import { analysisServiceBuilder } from '../../poc-horizon/dist/services/analysisService.js';
import { ruleDetectionServiceBuilder } from '../../poc-horizon/dist/services/ruleDetectionService.js';
import { modelDetectionServiceBuilder } from '../../poc-horizon/dist/services/modelDetectionService.js';
import { recognizeItalianIdentifiers } from '../../poc-horizon/dist/recognizers/registry.js';

export function createHandler({ infer, prepare, ready, recognize = recognizeItalianIdentifiers, onQueued }) {
  const ruleDetectionService = ruleDetectionServiceBuilder(recognize);
  const modelDetectionService = modelDetectionServiceBuilder({ ready, prepare, infer });
  return createApp({ ready: modelDetectionService.ready, onQueued,
    analysisService: analysisServiceBuilder({ ruleDetectionService, modelDetectionService }) });
}
