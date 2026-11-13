import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { sandbox, child } from './support/sandbox.mjs';

test('production detector calls model then real rule boundary, and model rejection suppresses rules', async t => {
  const { pkg, cwd } = await sandbox(t);
  const detectorURL = pathToFileURL(join(pkg, 'dist/services/ruleDetectionService.js')).href;
  const rules = `export function recognize(text) { globalThis.trace.push('rules:' + text); return new Set(['EMAIL_ADDRESS']); }`;
  const code = `
    import assert from 'node:assert/strict';
    import { registerHooks } from 'node:module';
    globalThis.trace = [];
    registerHooks({ resolve(specifier, context, next) {
      if (context.parentURL === ${JSON.stringify(detectorURL)} && specifier === '../recognizers/rules.js') return { url: ${JSON.stringify('data:text/javascript,' + encodeURIComponent(rules))}, shortCircuit: true };
      return next(specifier, context);
    } });
    const { ruleDetectionServiceBuilder } = await import(${JSON.stringify(detectorURL)});
    const { detectCategories } = await import(${JSON.stringify(pathToFileURL(join(pkg, 'dist/services/analysisService.js')).href)});
    const createDetector = async ({ modelFactory }) => { const model = await modelFactory(); return text => detectCategories(text, model, ruleDetectionServiceBuilder()); };
    const marker = new Error('synthetic failure');
    const detect = await createDetector({ modelFactory: async () => async text => { trace.push('model:' + text); if (text === 'fail') throw marker; return new Set(['PERSON']); } });
    assert.deepEqual([...await detect('first')], ['PERSON', 'EMAIL_ADDRESS']);
    await assert.rejects(() => detect('fail'), error => error === marker);
    assert.deepEqual(trace, ['model:first', 'rules:first', 'model:fail']);
    console.log('MODEL_BEFORE_RULES_PASS');
  `;
  const result = child(code, cwd);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  assert.match(result.stdout, /MODEL_BEFORE_RULES_PASS/);
});
