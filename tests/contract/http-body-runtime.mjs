import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import net from "node:net";
import { once } from "node:events";

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
    assert.equal((await post(port, ["\ufeff" + valid])).status, 200);
    assert.equal(calls.at(-1), "");
    const count = calls.length;
    for (const body of [
      '{"fields":[{"fieldId":"a","text":"ok","text":null}]}',
      '{"fields":[{"fieldId":"a","text":"\\ud800"}]}',
      '{"fields":[{"fieldId":"\\udc00","text":""}]}',
      '{"fields":[{"fieldId":"a","text":""},{"fieldId":"a","text":""}]}',
      '{"fields":[{"fieldId":"a","text":"","unknown":"\\ud800"}]}',
      "{",
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
      assert.equal(calls.length, count);
    }
  });
  test(`${engine}: split multibyte UTF-8 and malformed JSON follow the selected parser`, async (t) => {
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

    assert.equal(
      (await post(port, [prefix, unicode.subarray(0, 3)])).status,
      400,
    );
    assert.equal(calls.length, count);
  });

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
