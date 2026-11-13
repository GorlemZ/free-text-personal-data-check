// Test-only legacy call shape. Every analysis runs the real three service builders.
import { analysisServiceBuilder } from '../../poc-horizon/dist/services/analysisService.js';
import { ruleDetectionServiceBuilder } from '../../poc-horizon/dist/services/ruleDetectionService.js';
import { modelDetectionServiceBuilder } from '../../poc-horizon/dist/services/modelDetectionService.js';

export function analyzeFields(fields, adapter, recognize, _legacyResolver, threshold) {
  // Fixtures are a boundary: normalize omission here, never loosen the core Field DTO.
  const normalized = fields.map(field => ({ ...field,
    allowedCategories: field.allowedCategories === undefined ? [] : field.allowedCategories }));
  const ruleDetectionService = ruleDetectionServiceBuilder(recognize);
  // Canonical category aliases now use the real resolver (including legacy span fixtures).
  const modelDetectionService = modelDetectionServiceBuilder({ ready: async () => true, ...adapter }, threshold);
  return analysisServiceBuilder({ ruleDetectionService, modelDetectionService }).analyze(normalized);
}
