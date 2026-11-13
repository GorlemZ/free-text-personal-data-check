import type { Category, RawInference } from '../model/contracts.js';
import { interpretModelOutput } from '../model/modelInterpretation.js';
export function modelDetectionServiceBuilder({ infer }: { readonly infer: RawInference }) {
  return async (text: string): Promise<ReadonlySet<Category>> => interpretModelOutput((await infer(text)).output);
}
export type ModelDetectionService = ReturnType<typeof modelDetectionServiceBuilder>;
