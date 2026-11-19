import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = new URL("../../poc-horizon/src/", import.meta.url);
test("HTTP boundary has mandatory DI and no transitive runtime model dependency", () => {
  const app = new URL("app.ts", src);
  const entry = existsSync(app) ? app : new URL("server.ts", src);
  const seen = new Set();
  function inspect(url) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, "utf8");
    for (const match of source.matchAll(
      /import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/g,
    )) {
      const specifier = match[1];
      assert.doesNotMatch(
        specifier,
        /detector\.js|@huggingface|transformersAdapter|analyze-fields\.js/,
        `HTTP boundary must not import model/analysis runtime: ${fileURLToPath(url)}`,
      );
      if (specifier.startsWith("."))
        inspect(new URL(specifier.replace(/\.js$/, ".ts"), url));
    }
  }
  inspect(entry);
  assert.ok(
    existsSync(app),
    "createApp must own the dependency-injected HTTP boundary",
  );
  const source = readFileSync(app, "utf8");
  assert.match(
    source,
    /createApp\(deps:\s*AppDependencies\)/,
    "app dependencies are mandatory",
  );
  assert.doesNotMatch(source, /\.listen\(|process\.env/);
});

test("Horizon delegates method and path matching to a router framework", () => {
  const relative = "../../poc-horizon/src/app.ts";
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  assert.match(source, /from ["']@pagopa\/detector-http["']/, relative);
  assert.doesNotMatch(source, /request\.method|req\.method/, relative);
  assert.doesNotMatch(source, /request\.url|req\.url/, relative);
});

test("Horizon uses standard JSON parsing, Zod validation and framework serialization", () => {
  const shared = readFileSync(
    new URL("../../packages/detector-http/src/app.ts", import.meta.url),
    "utf8",
  );
  const app = readFileSync(
    new URL("../../poc-horizon/src/app.ts", import.meta.url),
    "utf8",
  );
  const router = readFileSync(
    new URL("../../poc-horizon/src/routers/analysisRouter.ts", import.meta.url),
    "utf8",
  );
  const validator = readFileSync(
    new URL(
      "../../poc-horizon/src/validation/analyzeRequest.ts",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(shared, /express\.json\(/);
  assert.match(app, /jsonBodyLimitBytes:\s*HTTP_LIMITS\.maxBodyBytes/);
  assert.match(validator, /\.safeParse\(/);
  assert.match(router, /res\.status\([^)]*\)\.send\(/);
  assert.doesNotMatch(router, /readBody|reply\(/);
  assert.doesNotMatch(validator, /JSON\.parse/);
});

test("Horizon delegates server lifecycle to the shared infrastructure package", () => {
  const relative = "../../poc-horizon/src/index.ts";
  const source = readFileSync(new URL(relative, import.meta.url), "utf8");
  assert.match(source, /startServer/);
  assert.match(source, /from ["']@pagopa\/detector-http["']/);
  assert.doesNotMatch(source, /createServer|server\.listen|process\.once/);
});
