import type { AutoModelForTokenClassification } from '@huggingface/transformers';
export const modelDirectory = new URL('../../models/', import.meta.url);
export const modelManifestPath = new URL('../../model-manifest.json', import.meta.url);
export type LoadModel = (path: string, options: { dtype: 'fp32'; device: 'cpu'; subfolder: ''; local_files_only: true }) => ReturnType<typeof AutoModelForTokenClassification.from_pretrained>;
export interface ModelOptions { readonly directory?: URL; readonly manifestPath?: URL; readonly loadModel?: LoadModel }
