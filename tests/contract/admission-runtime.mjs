import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";

export async function verifyBurst(createAdmission) {
  const admission = createAdmission(2, 0),
    gate = Promise.withResolvers(),
    calls = [];
  const jobs = Array.from({ length: 8 }, (_, i) =>
    admission.run(async () => {
      calls.push(i);
      await gate.promise;
      if (i === 0) throw Error("synthetic");
      return i;
    }),
  );
  const observed = jobs.map((job) =>
    job.then(
      (value) => ({ value }),
      (error) => ({ error: error.message }),
    ),
  );
  await new Promise((resolve) => setImmediate(resolve));
  try {
    assert.deepEqual(calls, [0, 1], "SAME_TURN_CAPACITY");
  } finally {
    gate.resolve();
  }
  const results = await Promise.all(observed);
  assert.deepEqual(
    results.slice(2),
    Array.from({ length: 6 }, () => ({ error: "SATURATED" })),
    "NO_EXCESS_EXECUTION",
  );
  assert.equal(await admission.run(async () => 42), 42, "ERROR_RECOVERY");
}

export function admissionTests() {
  test("same-turn burst reserves pending slots, rejects every excess and recovers after errors", async () => {
    const { createAdmission } = await import(
      `../../poc-bardsai/dist/http/admission.js`
    );
    for (const value of [
      0,
      -1,
      1.2,
      NaN,
      Infinity,
      Number.MAX_SAFE_INTEGER + 1,
    ])
      assert.throws(() => createAdmission(value), /CONCURRENCY/);
    await verifyBurst(createAdmission);
  });
  test("default admission provides one active and four bounded pending slots", async () => {
    const { createAdmission } = await import(
      `../../poc-bardsai/dist/http/admission.js`
    );
    const gate = Promise.withResolvers();
    const admission = createAdmission();
    const accepted = Array.from({ length: 5 }, (_, index) =>
      admission.run(async () => {
        await gate.promise;
        return index;
      }),
    );
    await assert.rejects(
      admission.run(async () => 5),
      {
        message: "SATURATED",
      },
    );
    gate.resolve();
    assert.deepEqual(await Promise.all(accepted), [0, 1, 2, 3, 4]);
  });
  test("bounded pending admission executes within the wait budget, rejects overflow and skips expired work", async () => {
    const { createAdmission } = await import(
      `../../poc-bardsai/dist/http/admission.js`
    );
    const gate = Promise.withResolvers();
    const entered = Promise.withResolvers();
    const admission = createAdmission(1, 1, 25);
    const first = admission.run(async () => {
      entered.resolve();
      await gate.promise;
      return "first";
    });
    await entered.promise;
    let queuedRuns = 0;
    const queued = admission.run(async () => {
      queuedRuns++;
      return "queued";
    });
    await assert.rejects(
      admission.run(async () => "overflow"),
      {
        message: "SATURATED",
      },
    );
    gate.resolve();
    assert.equal(await first, "first");
    assert.equal(await queued, "queued");
    assert.equal(queuedRuns, 1);

    const timeoutGate = Promise.withResolvers();
    const timeoutEntered = Promise.withResolvers();
    const active = admission.run(async () => {
      timeoutEntered.resolve();
      await timeoutGate.promise;
    });
    await timeoutEntered.promise;
    let expiredRuns = 0;
    const expired = admission.run(async () => {
      expiredRuns++;
    });
    await assert.rejects(
      Promise.race([
        expired,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error("TIMEOUT_NOT_PROMPT")), 60),
        ),
      ]),
      { message: "QUEUE_TIMEOUT" },
    );
    assert.equal(expiredRuns, 0);
    timeoutGate.resolve();
    await active;
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(expiredRuns, 0);
  });
  test("queue deadline stops at admission start and an expired entry releases pending capacity", async () => {
    const { createAdmission } = await import(
      `../../poc-bardsai/dist/http/admission.js`
    );

    const activeGate = Promise.withResolvers();
    const activeEntered = Promise.withResolvers();
    const queuedEntered = Promise.withResolvers();
    const queuedFinish = Promise.withResolvers();
    const admission = createAdmission(1, 1, 100);
    const active = admission.run(async () => {
      activeEntered.resolve();
      await activeGate.promise;
    });
    await activeEntered.promise;
    const admittedBeforeDeadline = admission.run(async () => {
      queuedEntered.resolve();
      await queuedFinish.promise;
      return "completed-after-deadline";
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    activeGate.resolve();
    await active;
    await queuedEntered.promise;
    await new Promise((resolve) => setTimeout(resolve, 110));
    queuedFinish.resolve();
    assert.equal(await admittedBeforeDeadline, "completed-after-deadline");

    const blockedGate = Promise.withResolvers();
    const blockedEntered = Promise.withResolvers();
    const blocked = admission.run(async () => {
      blockedEntered.resolve();
      await blockedGate.promise;
    });
    await blockedEntered.promise;
    const expired = admission.run(async () => {
      assert.fail("EXPIRED_WORK_EXECUTED");
    });
    await assert.rejects(expired, { message: "QUEUE_TIMEOUT" });
    const replacement = admission.run(async () => "replacement");
    blockedGate.resolve();
    await blocked;
    assert.equal(await replacement, "replacement");
  });
  test("HTTP maps overflow and queue expiry to 503 without executing expired work", async (t) => {
    const { createApp } = await import(`../../poc-bardsai/dist/app.js`);
    const gate = Promise.withResolvers();
    const entered = Promise.withResolvers();
    let calls = 0;
    const analyze = async () => {
      calls++;
      if (calls === 1) {
        entered.resolve();
        await gate.promise;
      }
      return [];
    };
    const analysisService = { analyze };
    const server = createServer(
      createApp({
        analysisService,
        ready: () => true,
        concurrency: 1,
        maxPendingRequests: 1,
        maxQueueWaitMs: 25,
      }),
    );
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(() => {
      gate.resolve();
      server.closeAllConnections();
      server.close();
    });
    const url = `http://127.0.0.1:${server.address().port}/v1/analyze`;
    const options = {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fields: [{ fieldId: "field", text: "text" }] }),
    };
    const first = fetch(url, options);
    await entered.promise;
    const expiring = fetch(url, options);
    const overflow = await fetch(url, options);
    assert.equal(overflow.status, 503);
    assert.deepEqual(await overflow.json(), { code: "detector_unavailable" });
    const expired = await expiring;
    assert.equal(expired.status, 503);
    assert.deepEqual(await expired.json(), { code: "detector_unavailable" });
    assert.equal(calls, 1, "EXPIRED_WORK_MUST_NOT_START");

    const replacement = fetch(url, options);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 1, "REPLACEMENT_MUST_WAIT_FOR_ACTIVE_SLOT");
    gate.resolve();
    assert.equal((await first).status, 200);
    assert.equal((await replacement).status, 200);
    assert.equal(calls, 2);
  });
  test(
    "client disconnect and timeout do not release a whole multi-field request",
    { timeout: 10000 },
    async (t) => {
      const { createApp } = await import(`../../poc-bardsai/dist/app.js`);
      const { analysisServiceBuilder } = await import(
        `../../poc-bardsai/dist/analysis.js`
      );
      const first = Promise.withResolvers(),
        second = Promise.withResolvers(),
        enteredFirst = Promise.withResolvers(),
        enteredSecond = Promise.withResolvers();
      const trace = [];
      t.after(() => {
        first.resolve();
        second.resolve();
      });
      const infer = async (text) => {
        trace.push(text);
        if (text === "first") {
          enteredFirst.resolve();
          await first.promise;
        }
        if (text === "second") {
          enteredSecond.resolve();
          await second.promise;
        }
        return [];
      };
      const analysisService = analysisServiceBuilder({
        model: { analyzeText: infer },
        recognize: () => new Set(),
      });
      const server = createServer(
        createApp({
          analysisService,
          ready: () => true,
          concurrency: 1,
          maxPendingRequests: 0,
        }),
      );
      server.listen(0, "127.0.0.1");
      await once(server, "listening");
      t.after(() => {
        server.closeAllConnections();
        server.close();
      });
      const base = `http://127.0.0.1:${server.address().port}`;
      const body = JSON.stringify({
        fields: [
          { fieldId: "a", text: "first" },
          { fieldId: "b", text: "second" },
        ],
      });
      const client = request(
        base + "/v1/analyze",
        { method: "POST", headers: { "content-type": "application/json" } },
        (res) => res.resume(),
      );
      client.on("error", () => {});
      client.end(body);
      await enteredFirst.promise;
      // A transport timeout terminates the client, not the underlying inference.
      const closed = new Promise((resolve) => client.once("close", resolve));
      client.setTimeout(1, () => client.destroy());
      await closed;
      const post = (body) =>
        fetch(base + "/v1/analyze", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        });
      assert.equal(
        (await post('{"fields":[]}')).status,
        400,
        "validation precedes admission",
      );
      assert.equal((await fetch(base + "/health/ready")).status, 200);
      assert.equal((await post(body)).status, 503);
      assert.deepEqual(trace, ["first"]);
      first.resolve();
      await enteredSecond.promise;
      assert.equal((await post(body)).status, 503);
      assert.deepEqual(trace, ["first", "second"], "slot spans fields");
      second.resolve();
      await new Promise((resolve) => setImmediate(resolve));
      const response = await post(
        JSON.stringify({ fields: [{ fieldId: "c", text: "recovery" }] }),
      );
      assert.equal(response.status, 200);
      assert.deepEqual(trace, ["first", "second", "recovery"]);
    },
  );
}
