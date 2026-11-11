import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, readFile, writeFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCorpus } from '../functional/load-corpus.mjs';

const exec = promisify(execFile);
const cli = fileURLToPath(new URL('../functional/run.mjs', import.meta.url));
const hook = fileURLToPath(new URL('./fixtures/cli-bootstrap.mjs', import.meta.url));
const imageIds = { presidio: 'sha256:' + 'a'.repeat(64), horizon: 'sha256:' + 'b'.repeat(64) };
const versions = { presidio: 'observed-presidio-cli-v1', horizon: 'observed-horizon-cli-v1' };
const runArgs = output => [cli, '--presidio-image', 'fake:p', '--horizon-image', 'fake:h', '--output-dir', output];

test('real validate entrypoint checks local tokenizer and reports the current review status', async () => {
  const plan = await loadCorpus();
  const result = await exec(process.execPath, [cli, '--validate-only']);
  assert.equal(result.stdout.trim(), `VALIDATED detection=${plan.detection.length} policy=${plan.policy.length} review=${plan.review.status}`);
});

test('real CLI retains the pending gold gate without touching Docker', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-cli-review-'));
  try {
    const settings = join(directory, 'config.json');
    const events = join(directory, 'events');
    await writeFile(settings, JSON.stringify({ reviewStatus: 'pending', events, imageIds }));
    const failed = await exec(process.execPath, ['--import', hook, ...runArgs(join(directory, 'unused'))], {
      env: { ...process.env, COMPARISON_FAKE_CONFIG: settings },
    }).catch(error => error);
    assert.equal(failed.code, 1);
    assert.equal(failed.stderr.trim(), 'GOLD_REVIEW_PENDING');
    const lifecycle = await readFile(events, 'utf8');
    assert.ok(!lifecycle.includes(':start'));
    assert.equal(lifecycle.split('\n').filter(x => x === 'gold:load').length, 1);
  } finally { await rm(directory, { recursive: true, force: true }); }
});

for (const mode of ['complete', '503', '400', 'malformed', 'version', 'timeout', 'interrupt',
  'readiness-interrupt', 'smoke-failed', 'startup-failed']) test(`real CLI + real lifecycle + HTTP fakes: ${mode}`, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'comparison-cli-'));
  const servers = [];
  const urls = {};
  const calls = { presidio: [], horizon: [] };
  const plan = await loadCorpus();
  let child;
  try {
    for (const name of ['presidio', 'horizon']) {
      const server = createServer(async (req, res) => {
        res.setHeader('content-type', 'application/json');
        assert.equal(req.headers.authorization, undefined);
        if (req.url === '/health/ready') {
          if (name === 'presidio' && mode === 'readiness-interrupt') { child.kill('SIGTERM'); return; }
          res.end('{"status":"ready"}'); return;
        }
        assert.equal(req.url, '/v1/analyze');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const field = JSON.parse(Buffer.concat(chunks)).fields[0];
        calls[name].push(field);
        const firstProbe = name === 'presidio' && calls[name].length === 2;
        if (name === 'presidio' && mode === 'smoke-failed') { res.statusCode = 503; res.end('{"code":"ANALYZER_UNAVAILABLE"}'); return; }
        if (firstProbe && ['503', '400'].includes(mode)) {
          res.statusCode = Number(mode);
          res.end(JSON.stringify({ code: mode === '400' ? 'INVALID_ANALYZE_REQUEST' : 'ANALYZER_UNAVAILABLE' })); return;
        }
        if (firstProbe && mode === 'malformed') { res.end('SENTINEL_RAW_FAILURE'); return; }
        if (firstProbe && mode === 'interrupt') { child.kill('SIGINT'); return; }
        if (firstProbe && mode === 'timeout') { setTimeout(() => res.end('{}'), 120); return; }
        res.end(JSON.stringify({ verdict: 'accepted', findings: [],
          modelPolicyVersion: firstProbe && mode === 'version' ? 'changed-version' : versions[name] }));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      urls[name] = `http://127.0.0.1:${server.address().port}`;
    }
    const settings = join(directory, 'config.json');
    const events = join(directory, 'events');
    const commands = join(directory, 'commands');
    await writeFile(settings, JSON.stringify({ urls, events, commands, imageIds, mode,
      reviewStatus: 'independently-reviewed', timeoutMs: mode === 'timeout' ? 60 : 30000 }));
    const output = join(directory, 'results');
    const result = await new Promise(resolve => {
      child = execFile(process.execPath, ['--import', hook, ...runArgs(output)], {
        env: { ...process.env, COMPARISON_FAKE_CONFIG: settings }, timeout: 20000,
      }, (error, stdout, stderr) => resolve({ code: error?.code ?? 0, stdout, stderr }));
    });
    const bundle = JSON.parse(await readFile(join(output, 'results.json')));
    const manifest = JSON.parse(await readFile(join(output, 'run-manifest.json')));
    const summary = JSON.parse(await readFile(join(output, 'summary.json')));
    assert.equal(bundle.runStatus, mode === 'complete' ? 'complete' : 'incomplete');
    assert.equal(result.code, mode === 'complete' ? 0 : mode === 'interrupt' ? 130 : mode === 'readiness-interrupt' ? 143 : 1);
    assert.equal(bundle.detectionUnits.length, plan.detection.length);
    assert.equal(bundle.policyUnits.length, plan.policy.length);
    const lifecycle = (await readFile(events, 'utf8')).trim().split('\n');
    assert.equal(lifecycle.filter(x => x === 'gold:load').length, 1);
    if (mode === 'startup-failed') {
      assert.ok(!lifecycle.includes('presidio:start'));
      assert.equal(manifest.failureCode, 'DOCKER_COMMAND_FAILED');
    } else {
      assert.ok(lifecycle.indexOf('presidio:start') < lifecycle.indexOf('presidio:stop'));
      if (!['smoke-failed', 'readiness-interrupt'].includes(mode)) assert.ok(lifecycle.includes('presidio:collect'));
    }
    const continueRun = ['complete', '503', 'timeout'].includes(mode);
    if (continueRun) {
      assert.ok(lifecycle.indexOf('presidio:stop') < lifecycle.indexOf('horizon:start'));
      assert.ok(lifecycle.includes('horizon:collect'));
      assert.equal(calls.presidio.length, plan.detection.length + plan.policy.length + 1);
      assert.equal(calls.horizon.length, plan.detection.length + plan.policy.length + 1);
      assert.deepEqual(calls.presidio.slice(1), [
        ...plan.detection.map(p => ({ fieldId: p.fieldId, text: p.text, allowedEntityTypes: [] })),
        ...plan.policy.map(p => ({ fieldId: p.fieldId, text: p.text, allowedEntityTypes: p.allowedEntityTypes })),
      ]);
      assert.equal(manifest.engines.horizon.modelPolicyVersion, versions.horizon);
    } else {
      assert.equal(calls.horizon.length, 0);
      assert.equal(summary.coverage.horizon.detection.unattempted, plan.detection.length);
      assert.equal(summary.coverage.presidio.policy.unattempted, plan.policy.length);
    }
    if (['malformed', 'version', '400', 'interrupt'].includes(mode)) {
      assert.equal(calls.presidio.length, 2);
      assert.equal(summary.coverage.presidio.detection.unattempted, plan.detection.length - 1);
    }
    if (mode === 'timeout') assert.equal(summary.coverage.presidio.detection.technicalErrors, 1);
    if (mode === 'interrupt') {
      assert.equal(summary.coverage.presidio.detection.technicalErrors, 1);
      assert.equal(summary.coverage.presidio.detection.contractErrors, 0);
    }
    if (mode === 'interrupt' || mode === 'readiness-interrupt') assert.equal(result.stderr.trim(), 'INTERRUPTED');
    for (const f of await readdir(output)) {
      const text = await readFile(join(output, f), 'utf8');
      assert.ok(!text.includes('SENTINEL_RAW_FAILURE'));
      assert.doesNotMatch(text, /"(?:text|rawBody|rationale|requestBody|responseBody)"\s*:/, f);
    }
    const invocations = (await readFile(commands, 'utf8')).trim().split('\n').map(JSON.parse);
    for (const args of invocations.filter(x => x[0] === 'run')) {
      assert.ok(Object.values(imageIds).includes(args.at(-1)));
      assert.equal(args[args.indexOf('--pull') + 1], 'never');
    }
    assert.ok(!invocations.some(x => ['build', 'pull', 'network', 'exec'].includes(x[0])));
    // Rerender in a separate process with current input reads explicitly forbidden.
    await writeFile(settings, JSON.stringify({ events, noInputReads: true }));
    const rendered = join(directory, 'render');
    const rerender = await exec(process.execPath, ['--import', hook, cli, '--render', join(output, 'results.json'), '--output-dir', rendered], {
      env: { ...process.env, COMPARISON_FAKE_CONFIG: settings },
    }).catch(error => error);
    assert.equal(rerender.code ?? 0, mode === 'complete' ? 0 : 1);
    assert.equal(await readFile(join(rendered, 'summary.json'), 'utf8'), await readFile(join(output, 'summary.json'), 'utf8'));
  } finally {
    await Promise.all(servers.map(s => new Promise(resolve => { s.closeAllConnections(); s.close(resolve); })));
    await rm(directory, { recursive: true, force: true });
  }
});
