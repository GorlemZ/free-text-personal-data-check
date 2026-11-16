import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateAnalyzeRequest } from "../../poc-horizon/dist/validation/analyzeRequest.js";
import { createHandler } from "./create-test-app.mjs";

const root = fileURLToPath(new URL("../../poc-horizon/", import.meta.url));
test("real compiler enforces closed readonly classification DTOs without offsets or candidates", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "horizon-domain-types-"));
  try {
    const contracts = join(root, "src/model/contracts.js");
    const source = `
      import type { Field, ModelPrediction, ModelAdapter, FieldAnalysis, Recognizer } from ${JSON.stringify(contracts)};
      const valid: Field = { fieldId: 'a', text: 'original', allowedCategories: ['PERSON'] };
      // @ts-expect-error closed category
      const invalidCategory: Field = { ...valid, allowedCategories: ['UNKNOWN'] };
      // @ts-expect-error required normalized allowlist
      const missing: Field = { fieldId: 'a', text: 'original' };
      // @ts-expect-error mandatory text cannot be null
      const nullText: Field = { ...valid, text: null };
      // @ts-expect-error readonly field
      valid.text = 'changed';
      // @ts-expect-error readonly array
      valid.allowedCategories.push('PERSON');
      // @ts-expect-error normalized allowlist cannot be null
      const nullAllowed: Field = { ...valid, allowedCategories: null };
      // @ts-expect-error model domain DTO has no offsets
      const span: ModelPrediction = { entity_group: 'PERSON', score: 0.9, start: 0 };
      declare const raw: Awaited<ReturnType<ModelAdapter['infer']>>;
      // @ts-expect-error external output is unknown
      const trusted: ModelPrediction = raw;
      const recognizer: Recognizer = () => new Set(['IT_IDENTITY_CARD']);
      // @ts-expect-error rule boundary is readonly
      recognizer('text').add('PERSON');
      // @ts-expect-error no candidate/offset protocol at the rule boundary
      const obsolete: Recognizer = () => [{ category: 'IT_IDENTITY_CARD', start: 0, end: 9 }];
      declare const analysis: FieldAnalysis;
      // @ts-expect-error immutable detected categories
      analysis.detected.add('PERSON');
      // @ts-expect-error immutable denied categories
      analysis.denied.add('PERSON');
      // @ts-expect-error removed candidates
      analysis.candidates;
      // @ts-expect-error removed possible categories
      analysis.possible;
    `;
    const probe = join(temporary, "probe.mts");
    await writeFile(probe, source);
    const config = JSON.parse(
      await (
        await import("node:fs/promises")
      ).readFile(join(root, "tsconfig.json"), "utf8"),
    );
    await writeFile(
      join(temporary, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          ...config.compilerOptions,
          rootDir: "/",
          noEmit: true,
          typeRoots: [join(root, "node_modules/@types")],
        },
        files: [probe],
      }),
    );
    const result = spawnSync(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        join(temporary, "tsconfig.json"),
      ],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    // @ts-expect-error must itself be checked, not silently stripped/transpiled.
    await writeFile(
      probe,
      source +
        '\n// @ts-expect-error intentionally unused control\nconst control: string = "valid";\n',
    );
    const control = spawnSync(
      process.execPath,
      [
        join(root, "node_modules/typescript/bin/tsc"),
        "-p",
        join(temporary, "tsconfig.json"),
      ],
      { encoding: "utf8" },
    );
    assert.notEqual(control.status, 0);
    assert.match(control.stdout, /TS2578: Unused '@ts-expect-error' directive/);
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("HTTP boundary normalizes omission only and rejects null without changing original text", async () => {
  const text = "  🙂e\u0301\t";
  assert.deepEqual(
    validateAnalyzeRequest(
      JSON.stringify({ fields: [{ fieldId: "a", text }] }),
    ),
    [{ fieldId: "a", text, allowedCategories: [] }],
  );
  const invalidFields = [
    null,
    { fieldId: null, text },
    { fieldId: "a", text: null },
    { fieldId: "a", text, allowedCategories: null },
    { fieldId: "a", text, allowedCategories: [null] },
  ];
  for (const field of invalidFields) {
    assert.throws(() =>
      validateAnalyzeRequest(JSON.stringify({ fields: [field] })),
    );
  }
  const calls = [];
  const server = createServer(
    createHandler({
      ready: async () => true,
      prepare: (text) => {
        calls.push(["prepare", text]);
        return { text };
      },
      infer: async () => {
        calls.push(["infer"]);
        return [];
      },
    }),
  );
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const post = (field) =>
      fetch(`http://127.0.0.1:${server.address().port}/v1/analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields: [field] }),
      });
    const valid = await post({ fieldId: "a", text });
    assert.equal(valid.status, 200);
    assert.deepEqual(await valid.json(), { verdict: "accepted", findings: [] });
    for (const field of invalidFields) {
      const invalid = await post(field);
      assert.equal(invalid.status, 400);
      assert.deepEqual(await invalid.json(), { code: "invalid_request" });
    }
    assert.deepEqual(
      calls,
      [["prepare", text], ["infer"]],
      "null must never reach services/inference",
    );
  } finally {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
});
