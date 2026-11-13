import { recognize } from '../recognizers/rules.js';
import type { Category } from '../model/contracts.js';
export function ruleDetectionServiceBuilder() { return (text: string): ReadonlySet<Category> => recognize(text); }
export type RuleDetectionService = ReturnType<typeof ruleDetectionServiceBuilder>;
