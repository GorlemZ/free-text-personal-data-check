import { SCORE_THRESHOLD, categoryOf, validateModelPrediction } from './categories.js';
import { modelSpanValid } from './semantics.js';
import type { Candidate, Category, Detection } from './contracts.js';

export function interpretModelResults(raw: readonly unknown[], text: string, threshold = SCORE_THRESHOLD): Detection {
  const detected = new Set<Category>();
  const possible = new Set<Category>();
  const candidates: Candidate[] = [];
  for (const value of raw) {
    const result = validateModelPrediction(value, text);
    const category = categoryOf(result, text);
    if (!category) continue;
    candidates.push({ source: 'model', category, score: result.score,
      ...(result.start === undefined ? {} : { start: result.start, end: result.end }) });
    if (!modelSpanValid(category, result, text)) continue;
    possible.add(category);
    if (result.score >= threshold) detected.add(category);
  }
  return { detected, possible, candidates };
}
