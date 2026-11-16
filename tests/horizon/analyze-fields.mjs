// Test-only fixture normalization around the real analysis service.
import { analysisServiceBuilder } from '../../poc-horizon/dist/services/analysisService.js';

export function analyzeFields(fields, adapter, recognize, _legacyResolver, threshold) {
  // Fixtures are a boundary: normalize omission here, never loosen the core Field DTO.
  const normalized = fields.map(field => ({ ...field,
    allowedCategories: field.allowedCategories === undefined ? [] : field.allowedCategories }));
  return analysisServiceBuilder({ adapter: { ready: async () => true, ...adapter }, recognize, threshold }).analyze(normalized);
}
