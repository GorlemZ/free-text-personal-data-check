import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, writeFile, rm, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../../poc-rizzo/', import.meta.url));
const ts = createRequire(join(root, 'package.json'))('typescript');

test('domain DTOs and all three ReturnType builder contracts reject invalid and mutable types under real strict NodeNext', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'rizzo-C-types-')); t.after(() => rm(dir, { recursive: true, force: true }));
  const configPath = join(root, 'tsconfig.json'), config = ts.readConfigFile(configPath, ts.sys.readFile);
  assert.equal(config.error, undefined);
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  assert.deepEqual(parsed.errors, []); assert.equal(ts.version, '5.9.3');
  const options = { ...parsed.options, noEmit: true }; delete options.rootDir;
  assert.equal(options.strict, true); assert.equal(options.exactOptionalPropertyTypes, true);
  assert.equal(options.module, ts.ModuleKind.NodeNext); assert.equal(options.moduleResolution, ts.ModuleResolutionKind.NodeNext);
  const path = name => JSON.stringify(join(root, 'src', name + '.js'));
  const fixture = `import type { Category, Field, Finding, RawInference } from ${path('model/contracts')};
import { analysisServiceBuilder, type AnalysisService } from ${path('services/analysisService')};
import { modelDetectionServiceBuilder, type ModelDetectionService } from ${path('services/modelDetectionService')};
import { ruleDetectionServiceBuilder, type RuleDetectionService } from ${path('services/ruleDetectionService')};
const category: Category = 'PERSON';
const fields: readonly Field[] = [{ fieldId: 'a', text: '', allowedCategories: [category] }];
const raw: RawInference = async () => ({ output: { external: 'untrusted' } });
const model: ModelDetectionService = modelDetectionServiceBuilder({ infer: raw });
const rules: RuleDetectionService = ruleDetectionServiceBuilder();
const analysis: AnalysisService = analysisServiceBuilder({ modelDetectionService: model, ruleDetectionService: rules });
const exactA: ReturnType<typeof analysisServiceBuilder> = analysis;
const exactM: ReturnType<typeof modelDetectionServiceBuilder> = model;
const exactR: ReturnType<typeof ruleDetectionServiceBuilder> = rules;
async function check() {
  const result = await analysis(fields);
  const envelope = await raw('x');
  const external: unknown = envelope.output;
  // @ts-expect-error external output remains unknown inside the envelope
  const categories: ReadonlySet<Category> = envelope.output;
  // @ts-expect-error result envelope is readonly
  envelope.output = [];
  const learned = await model('x'); const ruled = rules('x');
  // @ts-expect-error raw output is unknown, not validated categories
  const invalid: ReadonlySet<Category> = await raw('x');
  // @ts-expect-error readonly findings array
  result.push({ fieldId: 'a', category });
  // @ts-expect-error readonly finding
  result[0]!.category = category;
  // @ts-expect-error readonly learned categories
  learned.add(category);
  // @ts-expect-error readonly ruled categories
  ruled.add(category);
}
// @ts-expect-error raw inference must return an envelope, not the raw payload
const unboxed: RawInference = async () => [];
// @ts-expect-error envelope output is required
const missingEnvelope: RawInference = async () => ({});
// @ts-expect-error closed category
const wrong: Category = 'UNKNOWN';
// @ts-expect-error field allowlist required
const missing: Field = { fieldId: 'a', text: '' };
// @ts-expect-error allowlist never null
const nullable: Field = { fieldId: 'a', text: '', allowedCategories: null };
// @ts-expect-error allowlist cannot be explicitly undefined
const undef: Field = { fieldId: 'a', text: '', allowedCategories: undefined };
// @ts-expect-error readonly text
fields[0]!.text = 'x';
// @ts-expect-error readonly allowlist
fields[0]!.allowedCategories.push('PERSON');
// @ts-expect-error finding category required
const noCategory: Finding = { fieldId: 'a' };
// @ts-expect-error all DI mandatory
analysisServiceBuilder({ modelDetectionService: model });
`;
  async function diagnostics(text) { const file = join(dir, 'probe.mts'); await writeFile(file, text); return ts.getPreEmitDiagnostics(ts.createProgram({ rootNames: [file], options })).map(d => ({ code: d.code, message: ts.flattenDiagnosticMessageText(d.messageText, '\n') })); }
  assert.deepEqual(await diagnostics(fixture), []);
  assert.deepEqual((await diagnostics(fixture + '\n// @ts-expect-error unused positive control\nconst control: string = "valid";')).map(d => d.code), [2578]);
});

test('domain validation converter and service imports have no runtime dependency on SDK adapters or HTTP', async () => {
  for (const dir of ['model', 'validation', 'services']) for (const file of await readdir(join(root, 'src', dir))) {
    if (!file.endsWith('.ts')) continue;
    const source = ts.createSourceFile(file, await readFile(join(root, 'src', dir, file), 'utf8'), ts.ScriptTarget.Latest, true);
    for (const statement of source.statements) if (ts.isImportDeclaration(statement)) {
      const specifier = statement.moduleSpecifier.text;
      assert.doesNotMatch(specifier, /huggingface|onnxruntime|adapters|node:http|routers|utilities\/http/, dir + '/' + file);
    }
  }
});
