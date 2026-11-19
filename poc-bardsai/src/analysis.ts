import type {
  Field,
  FieldAnalysis,
  Category,
  Detection,
  Recognizer,
} from "./model/contracts.js";
import { categoriesOf } from "./bardsai/interpretation.js";
import type { BardsAiModel } from "./bardsai/model.js";
import { CATEGORY_SOURCES, isCategory } from "./model/categories.js";
import { recognizeItalianIdentifiers } from "./recognizers/registry.js";

export function analysisServiceBuilder({
  model,
  recognize = recognizeItalianIdentifiers,
}: Readonly<{
  model: BardsAiModel;
  recognize?: Recognizer;
}>) {
  return {
    async analyze(fields: readonly Field[]): Promise<readonly FieldAnalysis[]> {
      const analyses: FieldAnalysis[] = [];
      for (const field of fields) {
        const rawModel = await model.analyzeText(field.text);
        const learned = categoriesOf(rawModel);
        const ruleResult = detectRuleCategories(recognize(field.text));
        const detected = new Set([...learned, ...ruleResult.detected]);
        analyses.push({
          fieldId: field.fieldId,
          detected,
          denied: deniedCategories(detected, field.allowedCategories),
        });
      }
      return analyses;
    },
  };
}
export type AnalysisService = ReturnType<typeof analysisServiceBuilder>;

// Recognition and validation are local to the rule; this boundary only checks categories/ownership.
export function detectRuleCategories(raw: unknown): Detection {
  if (!(raw instanceof Set)) throw new Error("INVALID_RESULTS");
  return {
    detected: new Set(
      [...raw].filter((category) => {
        if (!isCategory(category)) throw new Error("INVALID_RULE_CATEGORY");
        return CATEGORY_SOURCES[category] === "rule";
      }),
    ),
  };
}

export function deniedCategories(
  detected: ReadonlySet<Category>,
  allowedCategories: readonly Category[],
): ReadonlySet<Category> {
  const allowed = new Set(allowedCategories);
  return new Set([...detected].filter((category) => !allowed.has(category)));
}

export type Finding = Readonly<{ fieldId: string; category: Category }>;
export type AnalyzeResponse = Readonly<{
  verdict: "accepted" | "rejected";
  findings: readonly Finding[];
}>;
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function toAnalyzeResponse(
  analyses: readonly FieldAnalysis[],
): AnalyzeResponse {
  const findings = analyses
    .flatMap(({ fieldId, denied }) =>
      [...denied].map((category) => ({ fieldId, category })),
    )
    .toSorted(
      (a, b) =>
        compare(a.fieldId, b.fieldId) || compare(a.category, b.category),
    );
  return { verdict: findings.length ? "rejected" : "accepted", findings };
}
