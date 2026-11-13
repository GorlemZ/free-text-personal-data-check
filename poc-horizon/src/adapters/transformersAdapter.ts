import { MODEL_CONFIG } from '../config/config.js';
import type { ModelAdapter, Prepared } from '../model/contracts.js';

export const MODEL_ID = MODEL_CONFIG.modelId;
export const MODEL_POLICY_VERSION = MODEL_CONFIG.policyVersion;

// The technical SDK seam is explicit; tests supply only synthetic runtime/pipelines.
export type TransformersPipeline = {
  (text: string, options: typeof MODEL_CONFIG.inferenceOptions): unknown | Promise<unknown>;
  tokenizer(text: string, options: typeof MODEL_CONFIG.tokenizerOptions): { input_ids: { size: number } };
};
export type TransformersRuntime = Readonly<{
  env: { allowRemoteModels: boolean; allowLocalModels: boolean; localModelPath: string; useBrowserCache: boolean };
  pipeline(task: typeof MODEL_CONFIG.task, model: string, options: typeof MODEL_CONFIG.options): Promise<TransformersPipeline>;
}>;
export type RuntimeLoader = () => Promise<TransformersRuntime>;
const loadRuntime: RuntimeLoader = async () => {
  const { pipeline, env } = await import('@huggingface/transformers');
  return { env, pipeline: (task, model, options) => pipeline(task, model, options) };
};

export function transformersAdapterBuilder({ loadRuntime: load = loadRuntime }: Readonly<{ loadRuntime?: RuntimeLoader }> = {}): ModelAdapter {
  let loading: Promise<TransformersPipeline> | undefined;
  function ready(): Promise<TransformersPipeline> {
    loading ??= Promise.resolve().then(async () => {
      const runtime = await load();
      runtime.env.allowRemoteModels = false;
      runtime.env.allowLocalModels = true;
      runtime.env.localModelPath = MODEL_CONFIG.root + '/';
      runtime.env.useBrowserCache = false;
      return runtime.pipeline(MODEL_CONFIG.task, MODEL_ID, MODEL_CONFIG.options);
    }).catch(error => { loading = undefined; throw error; });
    return loading;
  }
  return {
    ready,
    async prepare(text: string): Promise<Prepared> {
      const detector = await ready();
      const encoded = detector.tokenizer(text, MODEL_CONFIG.tokenizerOptions);
      if (encoded.input_ids.size > MODEL_CONFIG.tokenBudget) throw new Error('TOKEN_BUDGET_EXCEEDED');
      return { text };
    },
    async infer(prepared: Prepared): Promise<unknown> {
      const detector = await ready();
      return detector(prepared.text, MODEL_CONFIG.inferenceOptions);
    },
  };
}
export type TransformersAdapter = ReturnType<typeof transformersAdapterBuilder>;
