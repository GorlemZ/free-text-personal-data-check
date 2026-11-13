import { interpretModelResults } from '../model/modelInterpretation.js';
import { SCORE_THRESHOLD } from '../model/categories.js';
import type { ModelAdapter, Prepared } from '../model/contracts.js';

export function modelDetectionServiceBuilder(adapter: ModelAdapter, threshold = SCORE_THRESHOLD) {
  return {
    prepare: (text: string) => adapter.prepare(text),
    ready: () => adapter.ready(),
    infer: (prepared: Prepared): unknown | Promise<unknown> => adapter.infer(prepared),
    interpret: (raw: readonly unknown[], text: string) => interpretModelResults(raw, text, threshold),
  };
}
export type ModelDetectionService = ReturnType<typeof modelDetectionServiceBuilder>;
