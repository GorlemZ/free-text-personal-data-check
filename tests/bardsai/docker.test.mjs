import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const dockerfile = new URL("../../poc-bardsai/Dockerfile", import.meta.url);

test("container build verifies every manifest SHA-256 before startup", async () => {
  const source = await readFile(dockerfile, "utf8");
  assert.match(source, /createHash\(['"]sha256['"]\)/);
  assert.match(source, /MODEL_HASH_MISMATCH/);
  assert.match(source, /for await\s*\(const .* of createReadStream/);
});
