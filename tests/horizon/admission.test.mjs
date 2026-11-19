import test from "node:test";
import { admissionTests } from "../contract/admission-legacy.mjs";
admissionTests("horizon");
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createApp } from "../../poc-horizon/dist/app.js";

const deferred = () => Promise.withResolvers();
test("whole-request admission rejects excess without execution, health stays ready, errors release capacity", async (t) => {
  const gate = deferred();
  const entered = deferred();
  const calls = [];
  const app = createApp({
    concurrency: 1,
    maxPendingRequests: 0,
    ready: async () => true,
    analysisService: {
      async analyze(fields) {
        calls.push(fields);
        entered.resolve();
        await gate.promise;
        throw Error("synthetic");
      },
    },
  });
  const server = createServer(app);
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
  const second = await Promise.race([
    post(),
    new Promise((resolve) =>
      setTimeout(() => resolve({ status: "queued" }), 100),
    ),
  ]);
  gate.resolve();
  await first;
  assert.equal(second.status, 503);
  assert.equal(calls.length, 1);
  assert.equal((await post()).status, 503);
  assert.equal(calls.length, 2, "failure releases slot");
});
