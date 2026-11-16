import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";
import { PassThrough } from "node:stream";

// Real loopback transport, no SDK/model loads. Test-owned mutable traces are intentional.
export function httpBodyTests(engine, factory) {
  const cap = 1024 * 1024;
  const valid = '{"fields":[{"fieldId":"a","text":""}]}';
  async function fixture(t) {
    const calls = [];
    const server = factory((text) => {
      calls.push(text);
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    t.after(async () => {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    });
    return { server, calls, port: server.address().port };
  }
  function post(port, chunks, headers = {}) {
    return new Promise((resolve, reject) => {
      const req = http.request(
        {
          host: "127.0.0.1",
          port,
          path: "/v1/analyze",
          method: "POST",
          headers: { "content-type": "application/json", ...headers },
        },
        (res) => {
          const parts = [];
          res.on("data", (c) => parts.push(c));
          res.on("error", reject);
          res.on("end", () =>
            resolve({
              status: res.statusCode,
              headers: res.headers,
              body: JSON.parse(Buffer.concat(parts)),
            }),
          );
        },
      );
      req.on("error", reject);
      chunks.forEach((c) => req.write(c));
      req.end();
    });
  }
  test(`${engine}: utility sees separate UTF-8 chunks and ignores absent/malformed length hints`, async () => {
    const utility = await import(`../../poc-${engine}/dist/utilities/http.js`);
    for (const contentLength of [undefined, "broken", "1", String(cap + 1)]) {
      const stream = new PassThrough();
      stream.headers = {
        "content-type": "application/json",
        ...(contentLength === undefined
          ? {}
          : { "content-length": contentLength }),
      };
      const chunks = [];
      stream.on("data", (chunk) => chunks.push(chunk));
      const pending =
        engine === "horizon"
          ? utility.readBody(stream)
          : utility.readPayload(stream, {
              writeHead() {
                assert.fail("valid stream must not emit an error");
              },
              end() {
                assert.fail("valid stream must not emit an error");
              },
            });
      const prefix = '{"fields":[{"fieldId":"a","text":"';
      for (const chunk of [
        Buffer.from(prefix),
        ...[...Buffer.from("🙂")].map((byte) => Buffer.from([byte])),
        Buffer.from('"}]}'),
      ]) {
        stream.write(chunk);
        await new Promise((resolve) => setImmediate(resolve));
      }
      stream.end();
      const outcome = await pending;
      const value = engine === "horizon" ? JSON.parse(outcome) : outcome.value;
      assert.equal(value.fields[0].text, "🙂");
      assert.equal(
        chunks.length,
        6,
        "reader really received each UTF-8 fragment separately",
      );
      const oversized = new PassThrough();
      oversized.headers = stream.headers;
      const replies = [];
      const rejected =
        engine === "horizon"
          ? utility.readBody(oversized)
          : utility.readPayload(oversized, {
              setHeader() {},
              writeHead(status) {
                replies.push(status);
              },
              end(body) {
                replies.push(JSON.parse(body));
              },
            });
      oversized.end(Buffer.alloc(cap + 1, 0x20));
      if (engine === "horizon")
        await assert.rejects(
          rejected,
          (error) => error.constructor.name === "BodyTooLarge",
        );
      else {
        assert.deepEqual(await rejected, { ok: false });
        assert.deepEqual(replies, [413, { code: "body_too_large" }]);
      }
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(
        oversized.readableEnded,
        true,
        "excess body is resumed/drained after library pause",
      );
    }
  });
  test(`${engine}: last-wins JSON validates resulting schema, Unicode and repeated fieldIds`, async (t) => {
    const { port, calls } = await fixture(t);
    for (const body of [
      '{"fields":null,"fields":[{"fieldId":null,"fieldId":"a","text":"\\ud800","text":"ok"}]}',
      '{"fields":[],"\\u0066ields":[{"fieldId":"a","text":""}]}',
      '{"fields":[{"fieldId":"a","text":"old","\\u0074ext":"ok"}]}',
      '{"fields":[{"fieldId":"a","text":"","allowedCategories":null,"allowedCategories":[]}]}',
      '{"fields":[{"fieldId":"\\ud83d\\ude42","text":"\\ud83d\\ude42"}]}',
    ]) {
      assert.equal((await post(port, [body])).status, 200);
    }
    assert.deepEqual(calls, ["ok", "", "ok", "", "🙂"]);
    const count = calls.length;
    for (const body of [
      '{"fields":[{"fieldId":"a","text":"ok","text":null}]}',
      '{"fields":[{"fieldId":"a","text":"\\ud800"}]}',
      '{"fields":[{"fieldId":"\\udc00","text":""}]}',
      '{"fields":[{"fieldId":"a","text":""},{"fieldId":"a","text":""}]}',
      '{"fields":[{"fieldId":"a","text":"","unknown":"\\ud800"}]}',
      "{",
      "\ufeff" + valid,
    ]) {
      assert.deepEqual((await post(port, [body])).body, {
        code: "invalid_request",
      });
    }
    assert.equal(calls.length, count);
  });
  test(`${engine}: exact byte cap / +1 with and without content-length; reject before inference`, async (t) => {
    const { port, calls } = await fixture(t);
    for (const length of [false, true]) {
      const unicodeBody = valid.replace('"text":""', '"text":"🙂"');
      const body =
        unicodeBody + " ".repeat(cap - Buffer.byteLength(unicodeBody));
      assert.equal(
        (await post(port, [body], length ? { "content-length": cap } : {}))
          .status,
        200,
      );
      const count = calls.length;
      const response = await post(
        port,
        [body + " "],
        length ? { "content-length": cap + 1 } : {},
      );
      assert.equal(response.status, 413);
      assert.deepEqual(response.body, { code: "body_too_large" });
      if (engine === "rizzo")
        assert.equal(response.headers.connection, "close");
      assert.equal(calls.length, count);
    }
  });
  test(`${engine}: split multibyte UTF-8 accepted; invalid/truncated UTF-8 never infers`, async (t) => {
    const { port, calls } = await fixture(t);
    const prefix = Buffer.from('{"fields":[{"fieldId":"a","text":"');
    const suffix = Buffer.from('"}]}');
    const unicode = Buffer.from("🙂");
    assert.equal(
      (
        await post(port, [
          prefix,
          ...[...unicode].map((x) => Buffer.from([x])),
          suffix,
        ])
      ).status,
      200,
    );
    const count = calls.length;
    for (const bytes of [
      Buffer.from([0xff]),
      Buffer.from([0xc0, 0xaf]),
      Buffer.from([0xed, 0xa0, 0x80]),
      unicode.subarray(0, 3),
    ]) {
      const response = await post(port, [prefix, bytes, suffix]);
      assert.equal(response.status, 400);
      assert.deepEqual(response.body, { code: "invalid_request" });
    }
    assert.equal(
      (await post(port, [prefix, unicode.subarray(0, 3)])).status,
      400,
    );
    assert.equal(calls.length, count);
  });
  test(
    `${engine}: early oversized chunked response before upload end, then healthy request`,
    { timeout: 10000 },
    async (t) => {
      const { port, calls } = await fixture(t);
      const socket = net.createConnection({ host: "127.0.0.1", port });
      t.after(() => socket.destroy());
      await once(socket, "connect");
      const response = new Promise((resolve, reject) => {
        let received = "";
        socket.on("data", (chunk) => {
          received += chunk;
          if (received.includes("body_too_large")) resolve(received);
        });
        socket.on("error", reject);
        socket.on("end", () => reject(new Error("closed before response")));
      });
      socket.write(
        "POST /v1/analyze HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nTransfer-Encoding: chunked\r\n\r\n",
      );
      socket.write(
        (cap + 1).toString(16) + "\r\n" + "x".repeat(cap + 1) + "\r\n",
      );
      assert.match(await response, /^HTTP\/1\.1 413/);
      assert.equal(calls.length, 0);
      if (engine === "horizon") {
        // Finish the rejected body and reuse this exact connection after draining.
        const accepted = new Promise((resolve, reject) => {
          socket.on("data", (chunk) => {
            if (chunk.toString().includes('"verdict":"accepted"')) resolve();
          });
          socket.on("error", reject);
          socket.on("end", () =>
            reject(new Error("keepalive connection closed")),
          );
        });
        socket.write(
          "0\r\n\r\nPOST /v1/analyze HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: " +
            Buffer.byteLength(valid) +
            "\r\n\r\n" +
            valid,
        );
        await accepted;
        assert.equal(calls.length, 1);
      } else {
        if (!socket.readableEnded) await once(socket, "end");
        assert.equal(calls.length, 0);
      }
      socket.destroy();
      assert.equal((await post(port, [valid])).status, 200);
    },
  );
  test(
    `${engine}: malformed Content-Length rejected by Node framing; disconnect does not infer`,
    { timeout: 10000 },
    async (t) => {
      const { server, port, calls } = await fixture(t);
      const bad = net.createConnection({ host: "127.0.0.1", port });
      t.after(() => bad.destroy());
      await once(bad, "connect");
      const bytes = [];
      bad.on("data", (c) => bytes.push(c));
      const ended = once(bad, "end");
      bad.end(
        "POST /v1/analyze HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: broken\r\n\r\n" +
          valid,
      );
      await ended;
      assert.match(Buffer.concat(bytes).toString(), /^HTTP\/1\.1 400/);
      const abort = new Promise((resolve) =>
        server.once("request", (req) => req.once("aborted", resolve)),
      );
      const partial = net.createConnection({ host: "127.0.0.1", port });
      t.after(() => partial.destroy());
      await once(partial, "connect");
      partial.write(
        "POST /v1/analyze HTTP/1.1\r\nHost: localhost\r\nContent-Type: application/json\r\nContent-Length: 100\r\n\r\n{",
      );
      await new Promise((resolve) => setImmediate(resolve));
      partial.destroy();
      await abort;
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(calls.length, 0);
      assert.equal((await post(port, [valid])).status, 200);
    },
  );
}
