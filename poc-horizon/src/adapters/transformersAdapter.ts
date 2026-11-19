import { MODEL_CONFIG } from "../config/config.js";
import type { ModelAdapter, Prepared } from "../model/contracts.js";
import { env, pipeline } from "@huggingface/transformers";

export const MODEL_ID = MODEL_CONFIG.modelId;
export const MODEL_POLICY_VERSION = MODEL_CONFIG.policyVersion;

// The technical SDK seam is explicit; tests supply only synthetic runtime/pipelines.
export type TransformersPipeline = {
  (
    text: string,
    options: typeof MODEL_CONFIG.inferenceOptions,
  ): unknown | Promise<unknown>;
  tokenizer: ((
    text: string,
    options: typeof MODEL_CONFIG.tokenizerOptions,
  ) => { input_ids: { size: number } }) & { model_max_length?: number };
  model?: { config: { max_position_embeddings?: number } };
};
type PipelineFactory = () => Promise<TransformersPipeline>;

export async function transformersAdapterBuilder({
  tokenBudget = MODEL_CONFIG.tokenBudget,
  createPipeline = () =>
    pipeline(
      MODEL_CONFIG.task,
      MODEL_ID,
      MODEL_CONFIG.options,
    ) as Promise<TransformersPipeline>,
}: Readonly<{
  tokenBudget?: number;
  createPipeline?: PipelineFactory;
}> = {}): Promise<ModelAdapter> {
  if (
    !Number.isSafeInteger(tokenBudget) ||
    tokenBudget <= 0 ||
    tokenBudget > MODEL_CONFIG.tokenBudget
  )
    throw new TypeError("INVALID_TOKEN_BUDGET");
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = MODEL_CONFIG.root;
  env.useBrowserCache = false;
  const detector = await createPipeline();
  const safeLimit = Math.min(
    MODEL_CONFIG.tokenBudget,
    detector.model?.config.max_position_embeddings ?? MODEL_CONFIG.tokenBudget,
    detector.tokenizer.model_max_length ?? MODEL_CONFIG.tokenBudget,
  );
  if (
    !Number.isSafeInteger(safeLimit) ||
    safeLimit <= 0 ||
    tokenBudget > safeLimit
  )
    throw new TypeError("INVALID_TOKEN_BUDGET");
  return {
    ready: () => true,
    async prepare(text: string): Promise<Prepared> {
      const encoded = detector.tokenizer(text, MODEL_CONFIG.tokenizerOptions);
      if (encoded.input_ids.size > tokenBudget)
        throw new Error("TOKEN_BUDGET_EXCEEDED");
      return { text };
    },
    async infer(prepared: Prepared): Promise<unknown> {
      return detector(prepared.text, MODEL_CONFIG.inferenceOptions);
    },
  };
}
export type TransformersAdapter = ReturnType<typeof transformersAdapterBuilder>;
