import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function source(path) {
  return readFile(new URL(path, import.meta.url), "utf8");
}

test("Rizzo uses bounded standard JSON parsing and validates req.body", async () => {
  const [app, router, validation] = await Promise.all([
    source("../../poc-rizzo/src/app.ts"),
    source("../../poc-rizzo/src/routers/analysisRouter.ts"),
    source("../../poc-rizzo/src/validation/analyzeRequest.ts"),
  ]);

  assert.match(app, /jsonBodyLimitBytes:\s*HTTP_LIMITS\.maxBodyBytes/);
  assert.match(router, /analyzeRequest\(request\.body\)/);
  assert.match(validation, /AnalyzeRequestSchema\.safeParse\(body\)/);
  assert.doesNotMatch(router, /readPayload/);
});

test("Rizzo serializes route responses through Express", async () => {
  const [app, analysisRouter, healthRouter] = await Promise.all([
    source("../../poc-rizzo/src/app.ts"),
    source("../../poc-rizzo/src/routers/analysisRouter.ts"),
    source("../../poc-rizzo/src/routers/healthRouter.ts"),
  ]);

  for (const currentSource of [app, analysisRouter, healthRouter]) {
    assert.match(currentSource, /response\.status\([^)]*\)\.send\(/);
    assert.doesNotMatch(currentSource, /\bsend\(response,/);
  }
});

test("Rizzo no longer carries a custom raw-body dependency", async () => {
  const packageJson = JSON.parse(await source("../../poc-rizzo/package.json"));
  assert.equal(packageJson.dependencies["raw-body"], undefined);
});
