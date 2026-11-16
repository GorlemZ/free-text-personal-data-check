import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { modelDirectory, modelManifestPath, type ModelOptions } from '../config/modelConfig.js';
import type { RawInference } from '../model/contracts.js';

type Tokenizer = (text: string, options: { truncation: false; padding: false; add_special_tokens: true }) => { input_ids: { data: { length: number } } };
type Pipeline = (text: string, options: { aggregation_strategy: 'simple' }) => Promise<unknown>;
export function rawInferenceBuilder({ tokenizer, pipeline, maxTokens }: { readonly tokenizer: Tokenizer; readonly pipeline: Pipeline; readonly maxTokens: number }): RawInference {
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new TypeError('INVALID_TOKEN_BUDGET');
  return async text => {
    const encoded = tokenizer(text, { truncation: false, padding: false, add_special_tokens: true });
    if (encoded.input_ids.data.length > maxTokens) throw new Error('TOKEN_LIMIT');
    // Resolve only the pipeline's own Promise against its native result. A null-
    // prototype envelope crosses later async ports without re-assimilating raw.then.
    return { __proto__: null, output: await pipeline(text, { aggregation_strategy: 'simple' }) };
  };
}

export async function transformersAdapterBuilder(options: ModelOptions = {}) {
  if (options.tokenBudget !== undefined && (!Number.isSafeInteger(options.tokenBudget) || options.tokenBudget <= 0)) throw new TypeError('INVALID_TOKEN_BUDGET');
  const infer = await initializeModel(options);
  return { infer };
}
export type TransformersAdapter = ReturnType<typeof transformersAdapterBuilder>;

async function initializeModel({ directory = modelDirectory, manifestPath = modelManifestPath, loadModel, tokenBudget }: ModelOptions): Promise<RawInference> {
  const { AutoModelForTokenClassification, PreTrainedTokenizer, TokenClassificationPipeline, env } = await import('@huggingface/transformers');
  const manifest: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
  // Preserve direct access, Object.entries coercions and their original errors.
  const entries: readonly [string, unknown][] = Object.entries((manifest as { files: Record<string, unknown> }).files);
  for (const [file, expected] of entries) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(new URL(file, directory))) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error('MODEL_INTEGRITY_FAILURE');
  }
  const config: unknown = JSON.parse(await readFile(new URL('config.json', directory), 'utf8'));
  const tokenizerJSON: unknown = JSON.parse(await readFile(new URL('tokenizer.json', directory), 'utf8'));
  const modelLimit = (config as { max_position_embeddings: number }).max_position_embeddings;
  if (!Number.isSafeInteger(modelLimit) || modelLimit <= 0) throw new TypeError('INVALID_TOKEN_BUDGET');
  const tokenizer = new PreTrainedTokenizer(tokenizerJSON, { model_max_length: modelLimit });
  const safeLimit = Math.min(modelLimit, tokenizer.model_max_length);
  const maxTokens = tokenBudget ?? safeLimit;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0 || maxTokens > safeLimit) throw new TypeError('INVALID_TOKEN_BUDGET');
  env.allowRemoteModels = false;
  const loader = loadModel ?? ((path, options) => AutoModelForTokenClassification.from_pretrained(path, options));
  const model = await loader(fileURLToPath(directory), { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true });
  const pipeline = new TokenClassificationPipeline({ task: 'token-classification', model, tokenizer });
  return rawInferenceBuilder({ tokenizer, pipeline, maxTokens });
}
