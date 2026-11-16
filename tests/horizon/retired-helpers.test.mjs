import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';

// These helpers had no production/CLI consumers. Model-covered categories must
// not regain fallback rules through an accidentally retained compiled module.
test('retired rule helpers and decoder are absent from source and clean emit', () => {
  for (const module of ['fiscal-code', 'recognizers/credit-card', 'recognizers/phone', 'recognizers/italian-phone']) {
    for (const [directory, extension] of [['src', 'ts'], ['dist', 'js']]) {
      assert.equal(existsSync(new URL(`../../poc-horizon/${directory}/${module}.${extension}`, import.meta.url)), false, `${directory}/${module}`);
    }
  }
  assert.equal(existsSync(new URL('../rizzo/fixtures/legacy-decoder.mjs', import.meta.url)), false);
});

test('retired direct dependencies are absent, admission pins retained', () => {
  for (const [engine, retired] of [['horizon', 'libphonenumber-js'], ['rizzo', 'ibantools']]) {
    const read = file => JSON.parse(readFileSync(new URL(`../../poc-${engine}/${file}`, import.meta.url), 'utf8'));
    const pkg = read('package.json');
    const lock = read('package-lock.json');
    assert.equal(pkg.dependencies[retired], undefined);
    assert.equal(lock.packages[''].dependencies[retired], undefined);
    assert.equal(lock.packages[`node_modules/${retired}`], undefined);
    assert.equal(pkg.dependencies['p-limit'], '6.2.0');
    assert.equal(lock.packages['node_modules/p-limit'].version, '6.2.0');
    assert.equal(lock.packages['node_modules/yocto-queue'].version, '1.2.2');
  }
});
