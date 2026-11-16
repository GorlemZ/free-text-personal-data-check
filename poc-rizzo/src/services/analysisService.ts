import type {
  Category,
  Detection,
  Field,
  Finding,
} from "../model/contracts.js";
import { CATEGORY_SOURCES } from "../model/categories.js";
import { fieldPolicy, mergeCategories } from "../model/fieldPolicy.js";

export async function detectCategories(
  text: string,
  modelDetectionService: Detection,
  ruleDetectionService: (text: string) => ReadonlySet<Category>,
): Promise<ReadonlySet<Category>> {
  const learned = await modelDetectionService(text);
  const ruled = ruleDetectionService(text);
  return mergeCategories(
    learned,
    new Set(
      [...ruled].filter((category) => CATEGORY_SOURCES[category] === "rule"),
    ),
  );
}

export function analysisServiceBuilder({
  modelDetectionService,
  ruleDetectionService,
}: {
  readonly modelDetectionService: Detection;
  readonly ruleDetectionService: (text: string) => ReadonlySet<Category>;
}) {
  return async (fields: readonly Field[]): Promise<readonly Finding[]> => {
    return fields.reduce<Promise<readonly Finding[]>>(
      async (previous, field) => {
        const findings = await previous;
        const categories = await detectCategories(
          field.text,
          modelDetectionService,
          ruleDetectionService,
        );
        return [
          ...findings,
          ...fieldPolicy(field, categories, new Set(field.allowedCategories)),
        ];
      },
      Promise.resolve([]),
    );
  };
}
export type AnalysisService = ReturnType<typeof analysisServiceBuilder>;
