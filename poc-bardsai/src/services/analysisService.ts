import { deniedCategories } from "../model/fieldPolicy.js";
import type {
  Field,
  FieldAnalysis,
  ModelAdapter,
  Recognizer,
} from "../model/contracts.js";
import { categoriesOf } from "../model/modelInterpretation.js";
import { detectRuleCategories } from "./ruleDetectionService.js";
import { recognizeItalianIdentifiers } from "../recognizers/registry.js";

export function analysisServiceBuilder({
  adapter: model,
  recognize = recognizeItalianIdentifiers,
}: Readonly<{
  adapter: ModelAdapter;
  recognize?: Recognizer;
}>) {
  return {
    async analyze(fields: readonly Field[]): Promise<readonly FieldAnalysis[]> {
      return fields.reduce<Promise<readonly FieldAnalysis[]>>(
        async (previous, field) => {
          const analyses = await previous;
          const rawModel = await model.infer(await model.prepare(field.text));
          const learned = categoriesOf(rawModel);
          const ruleResult = detectRuleCategories(recognize(field.text));
          const detected = new Set([...learned, ...ruleResult.detected]);
          return [
            ...analyses,
            {
              fieldId: field.fieldId,
              detected,
              denied: deniedCategories(detected, field.allowedCategories),
            },
          ];
        },
        Promise.resolve([]),
      );
    },
  };
}
export type AnalysisService = ReturnType<typeof analysisServiceBuilder>;
