import { performance } from "node:perf_hooks";

const [baseUrl, engine] = process.argv.slice(2);
if (!baseUrl || !engine) throw new Error("usage: baseUrl engine");

const profiles = [
  {
    name: "S1",
    fields: [{ fieldId: "s1", text: "Mario Rossi vive a Roma." }],
  },
  {
    name: "S2",
    fields: [
      {
        fieldId: "s2",
        text: "Contatto sintetico: mario.rossi@example.com.",
      },
    ],
  },
  {
    name: "M5",
    fields: Array.from({ length: 5 }, (_, index) => ({
      fieldId: `m5-${index}`,
      text: `Campo sintetico ${index} relativo a Mario Rossi.`,
    })),
  },
  {
    name: "M10",
    fields: Array.from({ length: 10 }, (_, index) => ({
      fieldId: `m10-${index}`,
      text: `Campo sintetico ${index} relativo alla pratica amministrativa.`,
    })),
  },
];

const overflowProfile = {
  name: "TOKEN_OVERFLOW",
  fields: [
    {
      fieldId: "overflow",
      text: Array.from(
        { length: 50 },
        (_, index) =>
          `supercalifragilistichespiralidoso${index}elettroencefalograficamente`,
      ).join(" "),
    },
  ],
};

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
  const body = await response.json();
  return {
    profile: profile.name,
    status: response.status,
    body,
    latencyMs: performance.now() - started,
  };
}

function stableResult(observation) {
  return JSON.stringify({ status: observation.status, body: observation.body });
}

const baselines = new Map();
for (const profile of profiles) {
  const first = await analyze(profile);
  const second = await analyze(profile);
  if (first.status !== 200 || stableResult(first) !== stableResult(second))
    throw new Error(`unstable serial baseline: ${profile.name}`);
  baselines.set(profile.name, stableResult(first));
}

const pairs = [
  [profiles[0], profiles[3]],
  [profiles[1], profiles[2]],
  [profiles[3], profiles[0]],
  [profiles[2], profiles[1]],
];
const concurrentLatencies = [];
for (let round = 0; round < 5; round++) {
  for (const pair of pairs) {
    const observations = await Promise.all(pair.map(analyze));
    for (const observation of observations) {
      if (stableResult(observation) !== baselines.get(observation.profile))
        throw new Error(
          `cross-request contamination: ${observation.profile} round ${round}`,
        );
      concurrentLatencies.push(observation.latencyMs);
    }
  }
}

const [failed, validBesideFailure] = await Promise.all([
  analyze(overflowProfile),
  analyze(profiles[3]),
]);
if (
  failed.status !== 503 ||
  failed.body?.code !== "detector_unavailable"
)
  throw new Error(
    `expected token overflow 503, received ${failed.status} ${JSON.stringify(failed.body)}`,
  );
if (stableResult(validBesideFailure) !== baselines.get(profiles[3].name))
  throw new Error("valid request changed beside failing request");

process.stdout.write(
  `${JSON.stringify(
    {
      engine,
      candidate: "B",
      result: "pass",
      serialBaselines: profiles.length,
      simultaneousPairs: pairs.length * 5,
      simultaneousResponses: concurrentLatencies.length,
      failureIsolation: {
        failingStatus: failed.status,
        failingCode: failed.body.code,
        validStatus: validBesideFailure.status,
        validMatchesBaseline: true,
      },
    },
    null,
    2,
  )}\n`,
);
