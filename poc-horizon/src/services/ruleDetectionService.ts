import { recognizeItalianIdentifiers } from '../recognizers/registry.js';
import { isCategory } from '../model/categories.js';
import { isLocatedSpan, isRecord } from '../model/contracts.js';
import { ruleCategoryValid } from '../model/semantics.js';
import type { Category, Detection, Recognizer, RuleCandidate } from '../model/contracts.js';

export function ruleDetectionServiceBuilder(recognize: Recognizer = recognizeItalianIdentifiers) {
  return {
    // Collection must not inspect external shape or candidates before inference.
    collect: (text: string): unknown => recognize(text),
    interpret(raw: readonly unknown[], text: string): Detection {
      const detected = new Set<Category>();
      const possible = new Set<Category>();
      const candidates: RuleCandidate[] = [];
      for (const value of raw) {
        if (!isRecord(value)) throw new Error('INVALID_RULE_CANDIDATE');
        const { source, category, start, end, check } = value;
        const pair = { start, end };
        if (source !== 'rule' || !isLocatedSpan(pair, text) || !isCategory(category) ||
            (check !== 'not_checked' && check !== 'passed' && check !== 'failed'))
          throw new Error('INVALID_RULE_CANDIDATE');
        const candidate: RuleCandidate = { source, category, start: pair.start, end: pair.end, check };
        candidates.push(candidate);
        if (check !== 'failed' && ruleCategoryValid(category, text.slice(pair.start, pair.end))) {
          detected.add(category);
          possible.add(category);
        }
      }
      return { detected, possible, candidates };
    },
  };
}
export type RuleDetectionService = ReturnType<typeof ruleDetectionServiceBuilder>;
