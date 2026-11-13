import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { modelDirectory, modelManifestPath, type ModelOptions } from '../config/modelConfig.js';
import type { RawInference } from '../model/contracts.js';

type Tokenizer = (text: string, options: { truncation: false; padding: false }) => { input_ids: { data: { length: number } } };
type Pipeline = (text: string, options: { aggregation_strategy: 'simple' }) => Promise<unknown>;
export function rawInferenceBuilder({ tokenizer, pipeline, maxTokens }: { readonly tokenizer: Tokenizer; readonly pipeline: Pipeline; readonly maxTokens: number }): RawInference {
  return async text => {
    const encoded = tokenizer(text, { truncation: false, padding: false });
    if (encoded.input_ids.data.length > maxTokens) throw new Error('TOKEN_LIMIT');
    // Resolve only the pipeline's own Promise against its native result. A null-
    // prototype envelope crosses later async ports without re-assimilating raw.then.
    return { __proto__: null, output: await pipeline(text, { aggregation_strategy: 'simple' }) };
  };
}

export function transformersAdapterBuilder() {
  let initialization: Promise<RawInference> | undefined;
  // Not async: concurrent callers receive the exact same promise, including rejection.
  const warmup = (options: ModelOptions = {}): Promise<RawInference> => initialization ??= initializeModel(options);
  const infer: RawInference = async text => (await warmup())(text);
  return { warmup, infer };
}
export type TransformersAdapter = ReturnType<typeof transformersAdapterBuilder>;

async function initializeModel({ directory = modelDirectory, manifestPath = modelManifestPath, loadModel }: ModelOptions): Promise<RawInference> {
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
  // Deliberately read only after tokenizer JSON; re-read the budget after the loader.
  const tokenizer = new PreTrainedTokenizer(tokenizerJSON, { model_max_length: (config as { max_position_embeddings: number }).max_position_embeddings });
  env.allowRemoteModels = false;
  const loader = loadModel ?? ((path, options) => AutoModelForTokenClassification.from_pretrained(path, options));
  const model = await loader(fileURLToPath(directory), { dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true });
  const pipeline = new TokenClassificationPipeline({ task: 'token-classification', model, tokenizer });
  return rawInferenceBuilder({ tokenizer, pipeline, maxTokens: (config as { max_position_embeddings: number }).max_position_embeddings });
}
