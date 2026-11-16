import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "../../poc-horizon/node_modules/typescript/lib/typescript.js";
const root = fileURLToPath(new URL("../../", import.meta.url));
const mutators = new Set([
  "add",
  "set",
  "delete",
  "clear",
  "push",
  "pop",
  "shift",
  "unshift",
  "splice",
  "sort",
  "reverse",
  "fill",
  "copyWithin",
  "assign",
  "defineProperty",
  "defineProperties",
  "setPrototypeOf",
]);
function mutations(source) {
  const results = [];
  function visit(n) {
    if (
      (ts.isVariableDeclarationList(n) && !(n.flags & ts.NodeFlags.Const)) ||
      (ts.isBinaryExpression(n) &&
        n.operatorToken.kind >= ts.SyntaxKind.FirstAssignment &&
        n.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(n) || ts.isPostfixUnaryExpression(n)) &&
        [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(
          n.operator,
        )) ||
      ts.isDeleteExpression(n) ||
      (ts.isCallExpression(n) &&
        ((ts.isPropertyAccessExpression(n.expression) &&
          mutators.has(n.expression.name.text)) ||
          (ts.isElementAccessExpression(n.expression) &&
            ts.isStringLiteral(n.expression.argumentExpression) &&
            mutators.has(n.expression.argumentExpression.text))))
    )
      results.push(n.getText());
    ts.forEachChild(n, visit);
  }
  visit(source);
  return results;
}
const parse = (p, text) =>
  ts.createSourceFile(p, text, ts.ScriptTarget.Latest, true);
const boundaries = {
  "poc-horizon/src/adapters/transformersAdapter.ts": [
    "env.allowRemoteModels = false",
    "env.allowLocalModels = true",
    'env.localModelPath = MODEL_CONFIG.root + "/"',
    "env.useBrowserCache = false",
  ],
  "poc-horizon/src/index.ts": [
    "server.requestTimeout = HTTP_LIMITS.requestTimeout",
    "process.exitCode = 1",
    "process.exitCode = 0",
    "process.exitCode = 1",
  ],
  "poc-rizzo/src/index.ts": [
    "process.exitCode = 1",
    "process.exitCode = 0",
    "process.exitCode = 1",
  ],
  "poc-rizzo/src/adapters/transformersAdapter.ts": [
    "env.allowRemoteModels = false",
  ],
};
test("application guard detects hidden const accumulators and mutable bindings", () => {
  for (const s of [
    "let a=0",
    "x++",
    "x.a=1",
    "const a=[];a.push(1)",
    "const s=new Set();s.add(1)",
    'a["sort"]()',
    "Object.assign(a,b)",
  ])
    assert.ok(mutations(parse("control.ts", s)).length, s);
});
test("all runtime and CLI first-party sources: no application-owned mutable accumulators", () => {
  const graph = new Map();
  function visit(file) {
    if (graph.has(file)) return;
    const source = parse(file, fs.readFileSync(file, "utf8"));
    graph.set(file, mutations(source));
    for (const spec of ts.preProcessFile(source.text, true, true)
      .importedFiles) {
      if (spec.fileName.startsWith("."))
        visit(resolve(dirname(file), spec.fileName.replace(/\.js$/, ".ts")));
    }
  }
  for (const engine of ["horizon", "rizzo"])
    for (const entry of ["index", "scripts/smoke", "scripts/prefetch"])
      visit(resolve(root, `poc-${engine}/src/${entry}.ts`));
  const walk = (p) =>
    fs
      .readdirSync(p, { withFileTypes: true })
      .flatMap((e) =>
        e.isDirectory() ? walk(resolve(p, e.name)) : [resolve(p, e.name)],
      );
  for (const engine of ["horizon", "rizzo"]) {
    assert.ok(
      !fs.existsSync(
        resolve(root, `poc-${engine}/src/validation/strictJson.ts`),
      ),
      "retired scanner must be absent",
    );
    for (const file of walk(resolve(root, `poc-${engine}/src`)))
      assert.ok(graph.has(file), `source not covered by active graph: ${file}`);
    const http = fs.readFileSync(
      resolve(root, `poc-${engine}/src/utilities/http.ts`),
      "utf8",
    );
    assert.match(http, /from ["']raw-body["']/);
    assert.equal(
      JSON.parse(fs.readFileSync(resolve(root, `poc-${engine}/package.json`)))
        .dependencies["raw-body"],
      "2.5.2",
    );
  }
  const inventory = Object.fromEntries(
    [...graph].map(([file, writes]) => [relative(root, file), writes]),
  );
  console.log(
    "APPLICATION_GRAPH " +
      JSON.stringify({
        inventory,
        boundaries,
        externalState: [
          "raw-body buffering",
          "p-limit admission",
          "Node streams/server/process/filesystem",
          "SDK configuration/cache/inference",
        ],
      }),
  );
  for (const [file, writes] of Object.entries(inventory))
    assert.deepEqual(writes, boundaries[file] ?? [], file);
});
