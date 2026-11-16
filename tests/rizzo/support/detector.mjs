// Compatibility API for legacy tests, never imported by production.
import { createModel } from './model.mjs';
import { detectCategories } from '../../../poc-rizzo/dist/services/analysisService.js';
import { recognize } from '../../../poc-rizzo/dist/recognizers/rules.js';
export async function createDetector({ modelFactory = createModel } = {}) {
  const model = await modelFactory();
  const rules = recognize;
  return text => detectCategories(text, model, rules);
}
