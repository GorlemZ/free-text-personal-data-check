const [baseUrl, expectedHealthText, expectedWorkersText] = process.argv.slice(2);
const expectedHealth = Number(expectedHealthText);
const expectedWorkers = expectedWorkersText
  ?.split(",")
  .filter(Boolean)
  .map(Number);
if (!baseUrl || ![200, 503].includes(expectedHealth) || !expectedWorkers?.length)
  throw new Error("usage: baseUrl expectedHealth expectedWorkersCsv");

const ready = await fetch(`${baseUrl}/health/ready`);
if (ready.status !== expectedHealth)
  throw new Error(`expected readiness ${expectedHealth}, received ${ready.status}`);

const body = JSON.stringify({
  fields: [{ fieldId: "s1", text: "Mario Rossi vive a Roma." }],
});
const observedWorkers = [];
for (let index = 0; index < 4; index++) {
  const response = await fetch(`${baseUrl}/v1/analyze`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });
  if (response.status !== 200)
    throw new Error(`analysis failed with ${response.status}`);
  observedWorkers.push(Number(response.headers.get("x-benchmark-worker")));
  await response.json();
}
if (
  JSON.stringify(observedWorkers) !==
  JSON.stringify(
    Array.from(
      { length: 4 },
      (_, index) => expectedWorkers[index % expectedWorkers.length],
    ),
  )
)
  throw new Error(`unexpected distribution ${JSON.stringify(observedWorkers)}`);

process.stdout.write(
  `${JSON.stringify({
    readiness: ready.status,
    responses: observedWorkers.length,
    workers: observedWorkers,
  })}\n`,
);
