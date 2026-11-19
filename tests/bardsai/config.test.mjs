import { test } from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../../poc-bardsai/dist/config/config.js";

test("configuration defaults, overrides and invalid numeric values", () => {
  assert.deepEqual(loadConfig({}), {
    port: 8000,
    bindHost: "127.0.0.1",
    concurrency: 2,
    maxPendingRequests: 4,
    maxQueueWaitMs: 500,
    tokenBudget: 512,
  });
  assert.deepEqual(
    loadConfig({
      ANALYZER_PORT: "0",
      ANALYZER_BIND_HOST: "0.0.0.0",
      ANALYZER_CONCURRENCY: "3",
      ANALYZER_MAX_PENDING_REQUESTS: "0",
      ANALYZER_MAX_QUEUE_WAIT_MS: "25",
      ANALYZER_TOKEN_BUDGET: "100",
    }),
    {
      port: 0,
      bindHost: "0.0.0.0",
      concurrency: 3,
      maxPendingRequests: 0,
      maxQueueWaitMs: 25,
      tokenBudget: 100,
    },
  );
  for (const key of [
    "ANALYZER_PORT",
    "ANALYZER_CONCURRENCY",
    "ANALYZER_MAX_PENDING_REQUESTS",
    "ANALYZER_MAX_QUEUE_WAIT_MS",
    "ANALYZER_TOKEN_BUDGET",
  ]) {
    for (const value of ["", "  ", "-1", "1.5", "nope"])
      assert.throws(
        () => loadConfig({ [key]: value }),
        `${key}=${JSON.stringify(value)}`,
      );
  }
  assert.throws(() => loadConfig({ ANALYZER_TOKEN_BUDGET: "513" }));
  assert.throws(() => loadConfig({ ANALYZER_PORT: "65536" }));
  assert.throws(() => loadConfig({ ANALYZER_MAX_QUEUE_WAIT_MS: "2147483648" }));
  assert.throws(() => loadConfig({ ANALYZER_BIND_HOST: " " }));
});
