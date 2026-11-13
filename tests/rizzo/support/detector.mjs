// Compatibility API for legacy tests, never imported by production.
import { createModel } from './model.mjs';
import { detectCategories } from '../../../poc-rizzo/dist/services/analysisService.js';
import { ruleDetectionServiceBuilder } from '../../../poc-rizzo/dist/services/ruleDetectionService.js';
export async function createDetector({ modelFactory = createModel } = {}) {
  const model = await modelFactory();
  const rules = ruleDetectionServiceBuilder();
  return text => detectCategories(text, model, rules);
}
