import { test } from "node:test";
import assert from "node:assert/strict";
import { request } from "node:http";
import { startServer } from "../../packages/detector-http/dist/index.js";

test("shared server owns timeout and removes signal handlers when closed", async () => {
  const termListeners = process.listenerCount("SIGTERM");
  const intListeners = process.listenerCount("SIGINT");
  const server = await startServer((_request, response) => response.end(), {
    port: 0,
    host: "127.0.0.1",
    requestTimeout: 1234,
  });
  try {
    assert.equal(server.requestTimeout, 1234);
    assert.equal(process.listenerCount("SIGTERM"), termListeners + 1);
    assert.equal(process.listenerCount("SIGINT"), intListeners + 1);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
  assert.equal(process.listenerCount("SIGTERM"), termListeners);
  assert.equal(process.listenerCount("SIGINT"), intListeners);
});

test("timed out shutdown cannot be reported as clean completion", async () => {
  let requestStarted;
  const started = new Promise((resolve) => {
    requestStarted = resolve;
  });
  const events = [];
  const server = await startServer(
    () => requestStarted(),
    { port: 0, host: "127.0.0.1", shutdownTimeout: 10 },
    {
      onError: assert.fail,
      onShutdownComplete: () => events.push("complete"),
      onShutdownTimeout: () => events.push("timeout"),
    },
  );
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const client = request({ host: "127.0.0.1", port: address.port });
  client.on("error", () => undefined);
  client.end();
  await started;
  const closed = new Promise((resolve) => server.once("close", resolve));
  process.emit("SIGTERM");
  await closed;
  assert.deepEqual(events, ["timeout"]);
});
