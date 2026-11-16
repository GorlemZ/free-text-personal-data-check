// Legacy names live only here; all inference and interpretation are production functions.
import { transformersAdapterBuilder, rawInferenceBuilder } from '../../../poc-rizzo/dist/adapters/transformersAdapter.js';
import { modelDetectionServiceBuilder } from '../../../poc-rizzo/dist/services/modelDetectionService.js';
export { interpretSemanticEntities as semanticCategories } from '../../../poc-rizzo/dist/model/modelInterpretation.js';
export const createInference = options => modelDetectionServiceBuilder({ infer: rawInferenceBuilder(options) });
export const createModel = async (options = {}) => {
  const { infer } = await transformersAdapterBuilder(options);
  return modelDetectionServiceBuilder({ infer });
};
