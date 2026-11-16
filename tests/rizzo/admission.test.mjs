import test from "node:test";
import { admissionTests } from "../contract/admission-runtime.mjs";
admissionTests("rizzo");
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../../poc-rizzo/dist/app.js";
test("admission occupies entire request and rejects excess without execution", async (t) => {
  const gate = Promise.withResolvers(),
    entered = Promise.withResolvers(),
    calls = [];
  const server = createServer(
    createApp({
      concurrency: 1,
      maxPendingRequests: 0,
      ready: () => true,
      analysisService: async (fields) => {
        calls.push(fields);
        entered.resolve();
        await gate.promise;
        return [];
      },
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => {
    server.closeAllConnections();
    server.close();
  });
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = () =>
    fetch(base + "/v1/analyze", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        fields: [
          { fieldId: "a", text: "synthetic" },
          { fieldId: "b", text: "synthetic" },
        ],
      }),
    });
  const first = post();
  await entered.promise;
  assert.equal((await fetch(base + "/health/ready")).status, 200);
  const excess = await Promise.race([
    post(),
    new Promise((resolve) =>
      setTimeout(() => resolve({ status: "queued" }), 100),
    ),
  ]);
  gate.resolve();
  await first;
  assert.equal(excess.status, 503);
  assert.equal(calls.length, 1);
  assert.equal((await post()).status, 200);
  assert.equal(calls.length, 2);
});
