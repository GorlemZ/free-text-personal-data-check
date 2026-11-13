// Legacy names live only here; all inference and interpretation are production functions.
import { transformersAdapterBuilder, rawInferenceBuilder } from '../../../poc-rizzo/dist/adapters/transformersAdapter.js';
import { modelDetectionServiceBuilder } from '../../../poc-rizzo/dist/services/modelDetectionService.js';
export { interpretSemanticEntities as semanticCategories } from '../../../poc-rizzo/dist/model/modelInterpretation.js';
export const createInference = options => modelDetectionServiceBuilder({ infer: rawInferenceBuilder(options) });
const adapter = transformersAdapterBuilder();
let initialization;
export const createModel = (options = {}) => initialization ??= adapter.warmup(options).then(infer => modelDetectionServiceBuilder({ infer }));
