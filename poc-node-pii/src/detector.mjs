import { createModel } from './model.mjs';
import { recognize } from './rules.ts';
export async function createDetector() {
  const infer = await createModel();
  return async (text) => {
    // Inference must succeed even if a local rule already found a violation.
    const learned = await infer(text);
    return new Set([...learned, ...recognize(text)]);
  };
}
