import { performance } from "node:perf_hooks";

const [workerOne, workerTwo, engine] = process.argv.slice(2);
if (!workerOne || !workerTwo || !engine)
  throw new Error("usage: workerOne workerTwo engine");
const workers = [workerOne, workerTwo];

const profiles = [
  { name: "S1", fields: [{ fieldId: "s1", text: "Mario Rossi vive a Roma." }] },
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
  const statuses = await Promise.all(
    workers.map(async (worker) => {
      try {
        return (await fetch(`${worker}/health/ready`)).status;
      } catch {
        return 0;
      }
    }),
  );
  if (statuses.every((status) => status === 200)) break;
  if (attempt === 179) throw new Error("readiness timeout");
  await sleep(1000);
}

async function analyze(worker, profile) {
  const started = performance.now();
  const response = await fetch(`${worker}/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ fields: profile.fields }),
  });
  return {
    worker,
    profile: profile.name,
    status: response.status,
    body: await response.json(),
    latencyMs: performance.now() - started,
  };
}

function stableResult(observation) {
  return JSON.stringify({ status: observation.status, body: observation.body });
}

const baselines = new Map();
for (const profile of profiles) {
  const observations = await Promise.all(
    workers.map((worker) => analyze(worker, profile)),
  );
  if (
    observations.some(({ status }) => status !== 200) ||
    stableResult(observations[0]) !== stableResult(observations[1])
  )
    throw new Error(`cross-worker baseline mismatch: ${profile.name}`);
  baselines.set(profile.name, stableResult(observations[0]));
}

const assignments = [
  [profiles[0], profiles[3]],
  [profiles[1], profiles[2]],
  [profiles[3], profiles[0]],
  [profiles[2], profiles[1]],
];
const workerResponses = [0, 0];
for (let round = 0; round < 5; round++) {
  for (const assignment of assignments) {
    const observations = await Promise.all(
      workers.map((worker, index) => analyze(worker, assignment[index])),
    );
    for (const [index, observation] of observations.entries()) {
      if (stableResult(observation) !== baselines.get(observation.profile))
        throw new Error(
          `cross-process mismatch: ${observation.profile} round ${round}`,
        );
      workerResponses[index] += 1;
    }
  }
}

const [failed, validBesideFailure] = await Promise.all([
  analyze(workers[0], overflowProfile),
  analyze(workers[1], profiles[3]),
]);
if (failed.status !== 503 || failed.body?.code !== "detector_unavailable")
  throw new Error(`expected isolated token overflow, received ${failed.status}`);
if (stableResult(validBesideFailure) !== baselines.get(profiles[3].name))
  throw new Error("valid request changed beside failure in the other process");

process.stdout.write(
  `${JSON.stringify(
    {
      engine,
      candidate: "C",
      result: "pass",
      workers: workers.length,
      crossWorkerBaselines: profiles.length,
      simultaneousPairs: assignments.length * 5,
      simultaneousResponses: workerResponses.reduce(
        (total, value) => total + value,
        0,
      ),
      responsesByWorker: workerResponses,
      failureIsolation: {
        failingWorker: 1,
        failingStatus: failed.status,
        failingCode: failed.body.code,
        validWorker: 2,
        validStatus: validBesideFailure.status,
        validMatchesBaseline: true,
      },
    },
    null,
    2,
  )}\n`,
);
