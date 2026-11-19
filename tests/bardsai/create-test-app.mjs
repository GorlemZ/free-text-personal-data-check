import { createApp } from "../../poc-bardsai/dist/app.js";
import { analysisServiceBuilder } from "../../poc-bardsai/dist/analysis.js";
import { recognizeItalianIdentifiers } from "../../poc-bardsai/dist/recognizers/registry.js";

export function createHandler({
  analyzeText,
  ready,
  recognize = recognizeItalianIdentifiers,
  concurrency,
}) {
  return createApp({
    ready,
    concurrency,
    analysisService: analysisServiceBuilder({
      model: { analyzeText },
      recognize,
    }),
  });
}
