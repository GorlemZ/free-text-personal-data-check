import { createApp } from "../../poc-bardsai/dist/app.js";
import { analysisServiceBuilder } from "../../poc-bardsai/dist/services/analysisService.js";
import { recognizeItalianIdentifiers } from "../../poc-bardsai/dist/recognizers/registry.js";

export function createHandler({
  infer,
  prepare,
  ready,
  recognize = recognizeItalianIdentifiers,
  concurrency,
}) {
  const adapter = { ready, prepare, infer };
  return createApp({
    ready: adapter.ready,
    concurrency,
    analysisService: analysisServiceBuilder({ adapter, recognize }),
  });
}
