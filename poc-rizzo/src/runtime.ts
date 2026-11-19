import { transformersAdapterBuilder } from "./adapters/transformersAdapter.js";
import type { ModelOptions } from "./config/modelConfig.js";
import { recognize } from "./recognizers/rules.js";
import { analysisServiceBuilder } from "./services/analysisService.js";
import { modelDetectionServiceBuilder } from "./services/modelDetectionService.js";

// Manual smoke-only composition. The HTTP executable remains a linear root.
export async function composeRuntime(options: ModelOptions = {}) {
  const adapter = await transformersAdapterBuilder(options);
  const modelDetectionService = modelDetectionServiceBuilder({
    infer: adapter.infer,
  });
  const analysisService = analysisServiceBuilder({
    modelDetectionService,
    ruleDetectionService: recognize,
  });
  return { adapter, modelDetectionService, analysisService };
}
