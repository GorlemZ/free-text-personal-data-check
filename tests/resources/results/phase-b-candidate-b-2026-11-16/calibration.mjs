import { performance } from "node:perf_hooks";

const [baseUrl, engine] = process.argv.slice(2);
if (!baseUrl || !engine) throw new Error("usage: baseUrl engine");

const profiles = [
  { name: "S1", fields: [{ fieldId: "s1", text: "Mario Rossi vive a Roma." }] },
  {
    name: "S2",
    fields: [
      {
        fieldId: "s2",
        text: "Il cliente Mario Rossi può essere contattato all'indirizzo mario.rossi@example.com per aggiornare la pratica.",
      },
    ],
  },
  {
    name: "M5",
    fields: Array.from({ length: 5 }, (_, index) => ({
      fieldId: `m5-${index}`,
      text: `Campo ${index} relativo a Mario Rossi e alla pratica amministrativa corrente.`,
    })),
  },
  {
    name: "M10",
    fields: Array.from({ length: 10 }, (_, index) => ({
      fieldId: `m10-${index}`,
      text: `Campo ${index} relativo a Mario Rossi e alla pratica amministrativa corrente.`,
    })),
  },
];

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));
for (let attempt = 0; attempt < 180; attempt++) {
  try {
    const response = await fetch(`${baseUrl}/health/ready`);
    if (response.status === 200) break;
  } catch {}
  if (attempt === 179) throw new Error("readiness timeout");
  await sleep(1000);
}

async function analyze(profile) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: profile.fields }),
  });
  await response.json();
  return {
    profile: profile.name,
    fields: profile.fields.length,
    status: response.status,
    latencyMs: performance.now() - started,
  };
}

await Promise.all(
  Array.from({ length: 2 }, async (_, worker) => {
    for (let index = 0; index < 3; index++)
      await analyze(profiles[(worker * 3 + index) % profiles.length]);
  }),
);

const observations = [];
const started = performance.now();
await Promise.all(
  Array.from({ length: 2 }, async (_, worker) => {
    for (let index = worker; index < 30; index += 2)
      observations.push(await analyze(profiles[index % profiles.length]));
  }),
);
const elapsedMs = performance.now() - started;

function percentile(values, probability) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.ceil(probability * ordered.length) - 1];
}

const latencies = observations.map(({ latencyMs }) => latencyMs);
const fields = observations.reduce((total, value) => total + value.fields, 0);
const statuses = Object.fromEntries(
  [...new Set(observations.map(({ status }) => status))].map((status) => [
    status,
    observations.filter((observation) => observation.status === status).length,
  ]),
);

process.stdout.write(
  `${JSON.stringify(
    {
      engine,
      candidate: "B",
      sample: "two-client-calibration",
      clients: 2,
      requests: observations.length,
      fields,
      elapsedMs,
      requestsPerSecond: observations.length / (elapsedMs / 1000),
      fieldsPerSecond: fields / (elapsedMs / 1000),
      latencyMs: {
        p50: percentile(latencies, 0.5),
        p90: percentile(latencies, 0.9),
        p95: percentile(latencies, 0.95),
        p99: percentile(latencies, 0.99),
        max: Math.max(...latencies),
      },
      statuses,
    },
    null,
    2,
  )}\n`,
);
