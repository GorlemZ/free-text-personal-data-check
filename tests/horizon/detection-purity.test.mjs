import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from '../../poc-horizon/node_modules/typescript/lib/typescript.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
// Composition-selected entry points, including injected Rizzo collaborators.
// SDK adapters, HTTP/admission, startup and token budgets are intentionally outside this pure core.
const roots = ['poc-horizon/src/services/analysisService.ts',
  'poc-rizzo/src/services/analysisService.ts', 'poc-rizzo/src/services/modelDetectionService.ts',
  'poc-rizzo/src/recognizers/rules.ts'];
const mutators = new Set(['add', 'set', 'delete', 'clear', 'push', 'pop', 'shift', 'unshift',
  'splice', 'sort', 'reverse', 'fill', 'copyWithin', 'assign', 'defineProperty', 'defineProperties', 'setPrototypeOf']);
function mutations(source) {
  const findings = [];
  function walk(node) {
    const forbidden = (ts.isVariableDeclarationList(node) && !(node.flags & ts.NodeFlags.Const)) ||
      (ts.isBinaryExpression(node) && node.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && node.operatorToken.kind <= ts.SyntaxKind.LastAssignment) ||
      ((ts.isPrefixUnaryExpression(node) || ts.isPostfixUnaryExpression(node)) && [ts.SyntaxKind.PlusPlusToken, ts.SyntaxKind.MinusMinusToken].includes(node.operator)) ||
      ts.isDeleteExpression(node) ||
      (ts.isCallExpression(node) && ((ts.isPropertyAccessExpression(node.expression) && mutators.has(node.expression.name.text)) ||
        (ts.isElementAccessExpression(node.expression) && ts.isStringLiteral(node.expression.argumentExpression) && mutators.has(node.expression.argumentExpression.text))));
    if (forbidden) findings.push({ line: source.getLineAndCharacterOfPosition(node.getStart()).line + 1, code: node.getText() });
    ts.forEachChild(node, walk);
  }
  walk(source);
  return findings;
}
const parse = (name, text) => ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);

test('purity guard detects let, reassignment and mutating const accumulators (positive control)', () => {
  for (const source of ['let n = 0;', 'var n = 0;', 'n += 1;', 'n++;', 'const x = []; x.push(1);', 'const s = new Set(); s.add(1);', 'x["splice"](0);', 'delete x.a;']) {
    assert.ok(mutations(parse('control.ts', source)).length, source);
  }
  assert.deepEqual(mutations(parse('control.ts', 'const n = [1, 2].reduce((sum, x) => sum + x, 0);')), []);
});

test('entire transitive active detection graph has no mutable bindings, writes or accumulator methods', () => {
  const graph = new Map();
  function visit(file) {
    if (graph.has(file)) return;
    const source = parse(file, readFileSync(file, 'utf8'));
    graph.set(file, { dependencies: [], mutations: mutations(source) });
    for (const specifier of ts.preProcessFile(source.text, true, true).importedFiles) {
      assert.ok(specifier.fileName.startsWith('.'), `unexpected external core dependency: ${specifier.fileName}`);
      const dependency = resolve(dirname(file), specifier.fileName.replace(/\.js$/, '.ts'));
      graph.get(file).dependencies.push(relative(root, dependency));
      visit(dependency); // No allowlist, changed-files filter or manual exclusions below the roots.
    }
  }
  roots.forEach(file => visit(resolve(root, file)));
  const inventory = Object.fromEntries([...graph].map(([file, entry]) => [relative(root, file), entry]));
  console.log('CORE_GRAPH ' + JSON.stringify({ roots, inventory }));
  for (const required of ['fiscal-code', 'vat', 'italian-iban']) {
    assert.ok(graph.has(resolve(root, `poc-horizon/src/recognizers/${required}.ts`)), required);
  }
  assert.deepEqual(Object.fromEntries(Object.entries(inventory).filter(([, entry]) => entry.mutations.length)), {});
});
