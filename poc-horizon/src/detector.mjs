import { pipeline, env } from '@huggingface/transformers';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export const MODEL_ID = 'Horizon-Labs/pii-redactor-base';
export const MODEL_POLICY_VERSION = 'horizon-pii-redactor-base-q8-ef0eff8e-poc1';
const root = resolve(fileURLToPath(new URL('../models/', import.meta.url)));
env.allowRemoteModels = false;
env.allowLocalModels = true;
env.localModelPath = root + '/';
env.useBrowserCache = false;

let loading;
export function getDetector() {
  loading ??= pipeline('token-classification', MODEL_ID, {
    dtype: 'q8', device: 'cpu', local_files_only: true,
  }).catch(error => { loading = undefined; throw error; });
  return loading;
}

export async function detect(text) {
  const detector = await getDetector();
  // Transformers.js token-classification silently truncates; explicitly fail closed instead.
  const encoded = detector.tokenizer(text, { truncation: false, padding: false });
  if (encoded.input_ids.size > 512) throw new Error('TOKEN_BUDGET_EXCEEDED');
  return detector(text, { aggregation_strategy: 'simple' });
}
