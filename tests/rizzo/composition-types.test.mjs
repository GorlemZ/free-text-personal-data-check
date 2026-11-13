import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = fileURLToPath(new URL('../../poc-rizzo/', import.meta.url));
const ts = createRequire(join(packageRoot, 'package.json'))('typescript');

test('composition contracts require explicit DI and closed readonly normalized categories under the actual compiler', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'rizzo-B-types-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const configPath = join(packageRoot, 'tsconfig.json');
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, packageRoot, undefined, configPath);
  assert.deepEqual(parsed.errors, []);
  const options = { ...parsed.options, noEmit: true };
  delete options.rootDir;
  assert.equal(options.strict, true); assert.equal(options.exactOptionalPropertyTypes, true);
  const file = join(directory, 'fixture.mts');
  const app = JSON.stringify(join(packageRoot, 'src/app.js'));
  const validation = JSON.stringify(join(packageRoot, 'src/model/contracts.js'));
  const converter = JSON.stringify(join(packageRoot, 'src/model/contracts.js'));
  const source = `import { createApp } from ${app};
import type { RequestListener } from 'node:http';
import type { Field } from ${validation};
import type { Finding } from ${converter};
const fields: readonly Field[] = [{ fieldId: 'a', text: '', allowedCategories: ['PERSON'] }];
const finding: Finding = { fieldId: 'a', category: 'PERSON' };
const listener = createApp({ ready: () => 'truthy', analysisService: normalized => { const f: readonly Field[] = normalized; return [finding]; } });
// @ts-expect-error missing mandatory readiness
createApp({ analysisService: () => [] });
// @ts-expect-error missing mandatory analysis service
createApp({ ready: () => true });
// @ts-expect-error no default dependencies
createApp();
// @ts-expect-error unknown result category
createApp({ ready: () => true, analysisService: () => [{ fieldId: 'a', category: 'UNKNOWN' }] });
// @ts-expect-error normalized allowlist is always present
const missing: Field = { fieldId: 'a', text: '' };
// @ts-expect-error null is not an allowlist
const nullable: Field = { fieldId: 'a', text: '', allowedCategories: null };
// @ts-expect-error unknown input category
const unknown: Field = { fieldId: 'a', text: '', allowedCategories: ['UNKNOWN'] };
// @ts-expect-error normalized field is readonly
fields[0]!.text = 'changed';
// @ts-expect-error findings are readonly
finding.category = 'EMAIL_ADDRESS';
`;
  // The fixture lives outside node_modules resolution; use an assignment through the real app type instead of importing Node there.
  const fixture = source.replace("import type { RequestListener } from 'node:http';\n", '');
  async function diagnostics(text) {
    await writeFile(file, text);
    const program = ts.createProgram({ rootNames: [file], options });
    return ts.getPreEmitDiagnostics(program).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') }));
  }
  assert.deepEqual(await diagnostics(fixture), []);
  const control = await diagnostics(fixture + '\n// @ts-expect-error intentional unused directive positive control\nconst unusedControl: string = "valid";\n');
  assert.deepEqual(control.map(x => x.code), [2578]);
  for (const name of await readdir(join(packageRoot, 'src'), { recursive: true })) if (name.endsWith('.ts')) {
    const text = await readFile(join(packageRoot, 'src', name), 'utf8');
    const sourceFile = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    function visit(node) { assert.notEqual(node.kind, ts.SyntaxKind.AnyKeyword, name + ': forbidden any'); ts.forEachChild(node, visit); }
    visit(sourceFile);
  }
});
