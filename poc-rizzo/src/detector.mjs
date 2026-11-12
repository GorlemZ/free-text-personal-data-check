import { createModel } from './model.mjs';
import { recognize } from './rules.ts';
export async function createDetector({ modelFactory = createModel } = {}) {
  const infer = await modelFactory();
  return async (text) => {
    // Inference must succeed even if a local rule already found a violation.
    const learned = await infer(text);
    return new Set([...learned, ...recognize(text)]);
  };
}
