import { createServer } from "node:http";

const [portText, ...workers] = process.argv.slice(2);
const port = Number(portText);
if (!Number.isSafeInteger(port) || port < 1 || port > 65535 || workers.length !== 2)
  throw new Error("usage: port workerOne workerTwo");

let cursor = 0;

async function readyWorkers() {
  const states = await Promise.all(
    workers.map(async (worker, index) => {
      try {
        const response = await fetch(`${worker}/health/ready`);
        return response.status === 200 ? index : undefined;
      } catch {
        return undefined;
      }
    }),
  );
  return states.filter((index) => index !== undefined);
}

function sendJson(response, status, body, extraHeaders = {}) {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": bytes.length,
    ...extraHeaders,
  });
  response.end(bytes);
}

const server = createServer(async (request, response) => {
  try {
    const ready = await readyWorkers();
    if (request.method === "GET" && request.url === "/health/ready") {
      sendJson(response, ready.length === workers.length ? 200 : 503, {
        status: ready.length === workers.length ? "ready" : "unavailable",
      });
      return;
    }
    if (request.method !== "POST" || request.url !== "/v1/analyze") {
      sendJson(response, 404, { code: "not_found" });
      return;
    }
    if (ready.length === 0) {
      sendJson(response, 503, { code: "detector_unavailable" });
      return;
    }
    const workerIndex = ready[cursor % ready.length];
    cursor += 1;
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const upstream = await fetch(`${workers[workerIndex]}/v1/analyze`, {
      method: "POST",
      headers: { "content-type": request.headers["content-type"] ?? "" },
      body: Buffer.concat(chunks),
    });
    const body = Buffer.from(await upstream.arrayBuffer());
    response.writeHead(upstream.status, {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "content-length": body.length,
      "x-benchmark-worker": String(workerIndex + 1),
    });
    response.end(body);
  } catch {
    sendJson(response, 503, { code: "detector_unavailable" });
  }
});

server.listen(port, "127.0.0.1", () => {
  process.stdout.write(`router_ready ${port}\n`);
});

for (const signal of ["SIGINT", "SIGTERM"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
  });
}
