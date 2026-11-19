import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
test("one ONNX Runtime native ABI across direct and tokenizer dependencies", async () => {
  const lock = await readFile(
    new URL("../../pnpm-lock.yaml", import.meta.url),
    "utf8",
  );
  const versions = new Set(
    [...lock.matchAll(/onnxruntime-node@([^:\s(]+)/g)].map((match) => match[1]),
  );
  assert.equal(
    versions.size,
    1,
    "multiple ONNX shared-library versions conflict on Linux",
  );
});
