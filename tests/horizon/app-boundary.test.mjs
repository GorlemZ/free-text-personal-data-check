import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src = new URL('../../poc-horizon/src/', import.meta.url);
test('HTTP boundary has mandatory DI and no transitive runtime model dependency', () => {
  const app = new URL('app.ts', src);
  const entry = existsSync(app) ? app : new URL('server.ts', src);
  const seen = new Set();
  function inspect(url) {
    if (seen.has(url.href)) return;
    seen.add(url.href);
    const source = readFileSync(url, 'utf8');
    for (const match of source.matchAll(/import\s+(?!type\b)[^;]*?from\s+['"]([^'"]+)['"]/g)) {
      const specifier = match[1];
      assert.doesNotMatch(specifier, /detector\.js|@huggingface|transformersAdapter|analyze-fields\.js/,
        `HTTP boundary must not import model/analysis runtime: ${fileURLToPath(url)}`);
      if (specifier.startsWith('.')) inspect(new URL(specifier.replace(/\.js$/, '.ts'), url));
    }
  }
  inspect(entry);
  assert.ok(existsSync(app), 'createApp must own the dependency-injected HTTP boundary');
  const source = readFileSync(app, 'utf8');
  assert.match(source, /createApp\(deps:\s*AppDependencies\)/, 'app dependencies are mandatory');
  assert.doesNotMatch(source, /\.listen\(|process\.env/);
});
