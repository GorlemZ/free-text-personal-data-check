import { deniedCategories } from '../model/fieldPolicy.js';
import type { Field, FieldAnalysis, Prepared } from '../model/contracts.js';
import type { ModelDetectionService } from './modelDetectionService.js';
import type { RuleDetectionService } from './ruleDetectionService.js';

export function analysisServiceBuilder({ ruleDetectionService: rules, modelDetectionService: model }: Readonly<{
  ruleDetectionService: RuleDetectionService; modelDetectionService: ModelDetectionService;
}>) {
  return {
    async analyze(fields: readonly Field[]): Promise<readonly FieldAnalysis[]> {
      const prepared: Prepared[] = [];
      for (const field of fields) prepared.push(await model.prepare(field.text));
      const analyses: FieldAnalysis[] = [];
      for (let index = 0; index < fields.length; index++) {
        const field = fields[index];
        const rawRules = rules.collect(field.text);
        const rawModel = await model.infer(prepared[index]);
        // One shared container guard, after BOTH producers, before EITHER interpreter.
        if (!Array.isArray(rawModel) || !Array.isArray(rawRules)) throw new Error('INVALID_RESULTS');
        const ruleResult = rules.interpret(rawRules, field.text);
        const modelResult = model.interpret(rawModel, field.text);
        const detected = new Set([...ruleResult.detected, ...modelResult.detected]);
        const possible = new Set([...ruleResult.possible, ...modelResult.possible]);
        const candidates = [...ruleResult.candidates, ...modelResult.candidates];
        const denied = deniedCategories(detected, field.allowedCategories);
        analyses.push({ fieldId: field.fieldId, detected, possible, denied, candidates });
      }
      return analyses;
    },
  };
}
export type AnalysisService = ReturnType<typeof analysisServiceBuilder>;
