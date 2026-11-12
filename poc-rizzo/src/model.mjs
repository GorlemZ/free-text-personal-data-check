import { readFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { AutoModelForTokenClassification, PreTrainedTokenizer, TokenClassificationPipeline, env } from '@huggingface/transformers';

export function createInference({tokenizer, pipeline, maxTokens}) {
  return async (text) => {
    const encoded = tokenizer(text, { truncation: false, padding: false });
    if (encoded.input_ids.data.length > maxTokens) throw new Error('TOKEN_LIMIT');
    const entities = await pipeline(text, { aggregation_strategy: 'simple' });
    if (!Array.isArray(entities)) throw new Error('INVALID_MODEL_OUTPUT');
    return semanticCategories(entities.map(entity => ({
      label: entity?.entity_group, text: entity?.word, score: entity?.score,
    })));
  };
}

let initialization;
export function createModel(options = {}) {
  return initialization ??= initializeModel(options);
}

async function initializeModel({
  directory = new URL('../models/', import.meta.url),
  manifestPath = new URL('../model-manifest.json', import.meta.url),
  loadModel = (path, options) => AutoModelForTokenClassification.from_pretrained(path, options),
} = {}) {
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  for (const [file, expected] of Object.entries(manifest.files)) {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(new URL(file, directory))) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error('MODEL_INTEGRITY_FAILURE');
  }
  const config = JSON.parse(await readFile(new URL('config.json', directory), 'utf8'));
  const tokenizer = new PreTrainedTokenizer(JSON.parse(await readFile(new URL('tokenizer.json', directory), 'utf8')), { model_max_length: config.max_position_embeddings });
  // AutoTokenizer requires tokenizer_config.json, absent from the pinned manifest.
  // Compose the public pipeline with the original tokenizer, without adding metadata.
  env.allowRemoteModels = false;
  const model = await loadModel(fileURLToPath(directory), {
    dtype: 'fp32', device: 'cpu', subfolder: '', local_files_only: true,
  });
  const pipeline = new TokenClassificationPipeline({ task: 'token-classification', model, tokenizer });
  return createInference({ tokenizer, pipeline, maxTokens: config.max_position_embeddings });
}

const MODEL_MAP = Object.freeze({ FULLNAME: 'PERSON', EMAIL: 'EMAIL_ADDRESS', CF: 'IT_FISCAL_CODE', PIVA: 'IT_VAT_CODE', IBAN: 'IBAN_CODE', CREDITCARDNUMBER: 'CREDIT_CARD' });
// Known native labels from the pinned model config. Unknown labels indicate
// incompatible output, not an innocuous extra category.
const NATIVE_LABELS = new Set(['AGE', 'AMOUNT', 'BUILDINGNUM', 'CATASTO', 'CF', 'CITY',
  'CREDITCARDNUMBER', 'DATE', 'DOCID', 'EMAIL', 'FULLNAME', 'GENDER', 'IBAN', 'ID_DOC',
  'ORG', 'PIVA', 'PROVINCE', 'STREET', 'TARGA', 'TELEPHONENUM', 'TIME', 'ZIPCODE']);
export function semanticCategories(entities) {
  if (!Array.isArray(entities)) throw new Error('INVALID_MODEL_OUTPUT');
  const categories = new Set();
  for (const entity of entities) {
    if (!entity || !NATIVE_LABELS.has(entity.label) || typeof entity.text !== 'string'
      || !Number.isFinite(entity.score) || entity.score < 0 || entity.score > 1) throw new Error('INVALID_MODEL_OUTPUT');
    if (entity.score < 0.5 || !entity.text) continue;
    if (MODEL_MAP[entity.label]) categories.add(MODEL_MAP[entity.label]);
    // TELEPHONENUM may omit a foreign prefix. Phone detection is exclusively
    // owned by rules over the original text, never by decoded model fragments.
    // ID_DOC conflates passport/identity/license. Only the explicit local rules distinguish these.
  }
  return categories;
}
