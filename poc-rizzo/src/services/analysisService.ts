import type { Category, Detection, Field, Finding } from '../model/contracts.js';
import { fieldPolicy, mergeCategories } from '../model/fieldPolicy.js';

export async function detectCategories(text: string, modelDetectionService: Detection, ruleDetectionService: (text: string) => ReadonlySet<Category>): Promise<Set<unknown>> {
  const learned = await modelDetectionService(text);
  const ruled = ruleDetectionService(text);
  return mergeCategories(learned, ruled);
}

export function analysisServiceBuilder({ modelDetectionService, ruleDetectionService }: {
  readonly modelDetectionService: Detection;
  readonly ruleDetectionService: (text: string) => ReadonlySet<Category>;
}) {
  return async (fields: readonly Field[]): Promise<readonly Finding[]> => {
    const findings: Finding[] = [];
    for (const field of fields) {
      const allowed: ReadonlySet<unknown> = new Set(field.allowedCategories);
      const categories = await detectCategories(field.text, modelDetectionService, ruleDetectionService);
      findings.push(...fieldPolicy(field, categories, allowed));
    }
    return findings;
  };
}
export type AnalysisService = ReturnType<typeof analysisServiceBuilder>;
