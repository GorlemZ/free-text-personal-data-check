// Fixture-only compatibility adapter: HTTP + real current analysis, never a mock service.
import { createApp } from "../../poc-horizon/dist/app.js";
import { analysisServiceBuilder } from "../../poc-horizon/dist/services/analysisService.js";
import { recognizeItalianIdentifiers } from "../../poc-horizon/dist/recognizers/registry.js";

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
