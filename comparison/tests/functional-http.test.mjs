import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { collectBundle } from '../functional/collect.mjs';
import { analyzeBundle } from '../functional/metrics.mjs';
import { renderReport } from '../functional/report.mjs';
import { TARGET_CATEGORIES } from '../catalog.mjs';
import { loadCapabilities } from '../functional/config.mjs';
import { loadCorpus } from '../functional/load-corpus.mjs';

const secret = 'SENTINEL_PRIVATE_INPUT';
const plan = () => ({ detection: [
  { detectionCaseId: 'd1', sourceIds: ['p1', 'p2'], fieldId: 'description', text: secret,
    expectedEntities: ['PERSON'], split: 'development', familyId: 'family1',
    strata: [{ sourceId: 'p1', focusCategory: 'PERSON', scenario: 'positive' },
      { sourceId: 'p2', focusCategory: 'PERSON', scenario: 'allowlisted' }] },
  { detectionCaseId: 'd2', sourceIds: ['p3'], fieldId: 'contactName', text: 'NEUTRAL_PRIVATE_INPUT',
    expectedEntities: [], split: 'development', familyId: 'family2',
    strata: [{ sourceId: 'p3', focusCategory: 'PERSON', scenario: 'negative' }] },
], policy: [
  { id: 'p1', fieldId: 'description', text: secret, expectedEntities: ['PERSON'],
    allowedEntityTypes: [], expectedVerdict: 'rejected' },
  { id: 'p2', fieldId: 'description', text: secret, expectedEntities: ['PERSON'],
    allowedEntityTypes: ['PERSON'], expectedVerdict: 'accepted' },
  { id: 'p3', fieldId: 'contactName', text: 'NEUTRAL_PRIVATE_INPUT', expectedEntities: [],
    allowedEntityTypes: [], expectedVerdict: 'accepted' },
], corpusHashes: { gold: 'a'.repeat(64) } });
const capabilities = { sampledCategories: ['PERSON'], unsampledCategories: TARGET_CATEGORIES.filter(c => c !== 'PERSON'),
  engines: Object.fromEntries(['presidio', 'horizon'].map(e => [e, {
    capabilities: { PERSON: { scope: 'test' } }, mapping: e === 'presidio' ?
      { PERSON: 'PERSON', NRP: 'NRP' } : { PERSON: 'PERSON' },
  }])) };
const reply = (fieldId, category, version) => ({ verdict: category ? 'rejected' : 'accepted',
  modelPolicyVersion: version, findings: category ? [{ fieldId, entityType: category }] : [] });

async function withServers(handlers, action) {
  const servers = [];
  const calls = { presidio: [], horizon: [] };
  try {
    const urls = {};
    for (const name of ['presidio', 'horizon']) {
      const server = createServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const payload = JSON.parse(Buffer.concat(chunks));
        calls[name].push({ url: req.url, payload });
        const answer = await handlers[name](payload, calls[name].length);
        if (answer.destroy) { req.socket.destroy(); return; }
        if (answer.delay) await new Promise(resolve => setTimeout(resolve, answer.delay));
        res.writeHead(answer.status ?? 200, { 'content-type': answer.type ?? 'application/json' });
        res.end(answer.raw ?? JSON.stringify(answer.body));
      });
      await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
      servers.push(server);
      urls[name] = `http://127.0.0.1:${server.address().port}`;
    }
    return await action({ urls, calls });
  } finally {
    await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))));
  }
}
const normal = version => payload => {
  const { fieldId, text, allowedEntityTypes } = payload.fields[0];
  const category = text === secret && !allowedEntityTypes.includes('PERSON') ? 'PERSON' : null;
  return { body: reply(fieldId, category, version) };
};
const run = urls => collectBundle({ plan: plan(), capabilities, urls,
  policyVersions: { presidio: 'p-v1', horizon: 'h-v1' }, timeoutMs: 100 });

test('collects two independent probes per engine, maps findings, and emits sanitized self-contained bundle', async () => {
  await withServers({ presidio: normal('p-v1'), horizon: normal('h-v1') }, async ({ urls, calls }) => {
    const bundle = await run(urls);
    assert.equal(bundle.schemaVersion, 1);
    assert.equal(bundle.runStatus, 'complete');
    assert.deepEqual(bundle.capabilities.categories, TARGET_CATEGORIES);
    assert.deepEqual(bundle.capabilities.engines.horizon.supportedCategories, ['PERSON']);
    assert.deepEqual(bundle.capabilities.engines.horizon.mapping, capabilities.engines.horizon.mapping);
    assert.equal(bundle.detectionUnits.length, 2);
    assert.equal(bundle.policyUnits.length, 3);
    assert.deepEqual(bundle.detectionUnits[0].sourceIds, ['p1', 'p2']);
    assert.deepEqual(bundle.observations.presidio.detection.d1, { status: 200, categories: ['PERSON'], verdict: 'rejected' });
    assert.deepEqual(bundle.observations.horizon.policy.p2, { status: 200, categories: [], verdict: 'accepted' });
    for (const name of ['presidio', 'horizon']) {
      assert.equal(calls[name].length, 5);
      assert.ok(calls[name].every(c => c.url === '/v1/analyze' && Object.keys(c.payload).join() === 'fields'));
      assert.deepEqual(calls[name].slice(0, 2).map(c => c.payload.fields[0].allowedEntityTypes), [[], []]);
      assert.deepEqual(calls[name].slice(2).map(c => c.payload.fields[0].allowedEntityTypes), [[], ['PERSON'], []]);
    }
    const summary = analyzeBundle(bundle);
    assert.equal(summary.policy.paired.presidio.counts.tp, 1);
    assert.equal(summary.policy.paired.presidio.counts.tn, 2);
    assert.match(renderReport(summary).markdown, /COMPLETE/);
    const json = JSON.stringify(bundle);
    assert.ok(!json.includes(secret) && !json.includes('NEUTRAL_PRIVATE_INPUT'));
    assert.ok(!json.includes('findings') && !json.includes('text'));
  });
});

test('wrong category can reject correctly while detection remains a false negative', async () => {
  const configured = structuredClone(capabilities);
  configured.engines.horizon.mapping.EMAIL = 'EMAIL_ADDRESS';
  configured.engines.horizon.capabilities.EMAIL_ADDRESS = { scope: 'test' };
  await withServers({ presidio: normal('p-v1'), horizon: payload => {
    const { fieldId, text, allowedEntityTypes } = payload.fields[0];
    return { body: reply(fieldId, text === secret && !allowedEntityTypes.includes('PERSON') ?
      'EMAIL_ADDRESS' : null, 'h-v1') };
  } }, async ({ urls }) => {
    const bundle = await collectBundle({ plan: plan(), capabilities: configured, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' } });
    const result = analyzeBundle(bundle);
    assert.equal(result.detection.paired.horizon.byCategory.PERSON.counts.fn, 1);
    assert.equal(result.policy.paired.horizon.counts.tp, 1);
    assert.deepEqual(bundle.observations.horizon.detection.d1.categories, ['EMAIL_ADDRESS']);
    assert.equal(result.detection.paired.horizon.byCategory.EMAIL_ADDRESS, undefined); // no gold focus for this axis
  });
});

test('503, timeout, and transport errors preserve independent probe denominators', async () => {
  await withServers({
    presidio: (payload, n) => n === 3 ? { status: 503, body: { code: 'ANALYZER_UNAVAILABLE' } } : normal('p-v1')(payload),
    horizon: (payload, n) => n === 1 ? { delay: 200, body: reply('description', 'PERSON', 'h-v1') } :
      n === 4 ? { destroy: true } : normal('h-v1')(payload),
  }, async ({ urls }) => {
    const bundle = await run(urls);
    assert.equal(bundle.runStatus, 'incomplete');
    assert.deepEqual(bundle.observations.presidio.policy.p1, { status: 503 });
    assert.deepEqual(bundle.observations.horizon.detection.d1, { status: 'transport-error' }); // client normalizes timeout to status 0
    assert.deepEqual(bundle.observations.horizon.policy.p2, { status: 'transport-error' });
    const result = analyzeBundle(bundle);
    assert.equal(result.coverage.presidio.detection.successes, 2);
    assert.equal(result.coverage.presidio.policy.technicalErrors, 1);
    assert.equal(result.coverage.horizon.detection.technicalErrors, 1);
    assert.equal(result.coverage.horizon.policy.technicalErrors, 1);
    assert.equal(result.coverage.presidio.detection.pairedSuccesses, 1);
    assert.equal(result.coverage.presidio.policy.pairedSuccesses, 1);
    assert.equal(result.policy.operational.presidio, null);
    assert.match(renderReport(result).markdown, /INCOMPLETE/);
  });
});

test('rejects model-native labels that the application must map before HTTP emission', async () => {
  const nativeCapabilities = structuredClone(capabilities);
  nativeCapabilities.engines.horizon.mapping.EMAIL = 'EMAIL_ADDRESS';
  await withServers({ presidio: normal('p-v1'), horizon: (payload, n) =>
    n === 4 ? { body: reply('description', 'EMAIL', 'h-v1') } : normal('h-v1')(payload) },
  async ({ urls }) => {
    const error = await collectBundle({ plan: plan(), capabilities: nativeCapabilities, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' } }).catch(e => e);
    assert.equal(error.message, 'INVALID_RESPONSE');
    assert.deepEqual(error.bundle.observations.horizon.policy.p2, { status: 'contract-error' });
    assert.equal(error.bundle.runStatus, 'incomplete');
    assert.equal(analyzeBundle(error.bundle).coverage.horizon.policy.unattempted, 1);
    assert.ok(!JSON.stringify(error).includes(secret));
    assert.ok(!JSON.stringify(error.bundle).includes(secret));
  });
});

test('HTTP contract failures stop immediately with sanitized partial evidence and unattempted units', async t => {
  const invalid = [
    ['400 on validated corpus', { status: 400, body: { code: 'INVALID_ANALYZE_REQUEST' } }, 'INVALID_ANALYZE_REQUEST', 400],
    ['wrong media type', { type: 'text/plain', raw: secret }, 'INVALID_RESPONSE', 'contract-error'],
    ['malformed JSON', { raw: secret }, 'INVALID_RESPONSE', 'contract-error'],
    ['response field mismatch', { body: reply('description', 'PERSON', 'p-v1') }, 'INVALID_RESPONSE', 'contract-error'],
    ['unexpected native label', { body: reply('description', 'UNKNOWN', 'p-v1') }, 'INVALID_RESPONSE', 'contract-error'],
    ['response leaks raw text', { body: { ...reply('description', null, 'p-v1'), text: secret } }, 'INVALID_RESPONSE', 'contract-error'],
    ['wrong policy version', { body: reply('description', null, 'other-version') }, 'POLICY_VERSION_MISMATCH', 'contract-error'],
    ['malformed 503', { status: 503, body: { code: 'ANALYZER_UNAVAILABLE', text: secret } }, 'INVALID_RESPONSE', 'contract-error'],
  ];
  for (const [title, answer, message, status] of invalid) await t.test(title, async () => {
    await withServers({ presidio: (payload, n) => n === 2 ? answer : normal('p-v1')(payload),
      horizon: normal('h-v1') }, async ({ urls, calls }) => {
      const error = await run(urls).catch(e => e);
      assert.equal(error.message, message);
      assert.equal(error.bundle.runStatus, 'incomplete');
      assert.deepEqual(error.bundle.observations.presidio.detection.d2, { status });
      assert.deepEqual(error.bundle.observations.presidio.detection.d1.categories, ['PERSON']);
      assert.equal(analyzeBundle(error.bundle).coverage.presidio.detection.unattempted, 0);
      assert.equal(analyzeBundle(error.bundle).coverage.presidio.policy.unattempted, 3);
      assert.equal(calls.presidio.length, 2);
      assert.equal(calls.horizon.length, 0);
      assert.ok(!JSON.stringify(error).includes(secret));
      assert.ok(!JSON.stringify(error.bundle).includes(secret));
    });
  });
});

test('rejects non-loopback, decorated, and path-bearing destinations before any request', async () => {
  await withServers({ presidio: normal('p-v1'), horizon: normal('h-v1') }, async ({ urls, calls }) => {
    for (const invalid of [
      'http://localhost:1234', 'http://[::1]:1234', 'http://0.0.0.0:1234',
      'https://127.0.0.1:1234', 'http://127.0.0.2:1234',
      'http://127.0.0.1', 'http://127.0.0.1:0',
      `${urls.presidio}/`, `${urls.presidio}/evil`, `${urls.presidio}?q=1`,
      `${urls.presidio}#fragment`, `http://user@127.0.0.1:1234`,
      `http://127.0.0.1:${new URL(urls.presidio).port}@example.com`,
      `http://127.0.0.1:${new URL(urls.presidio).port}\\@example.com`,
    ]) {
      const error = await run({ ...urls, horizon: invalid }).catch(e => e);
      assert.equal(error.message, 'INVALID_COLLECTION_CONFIG', invalid);
    }
    assert.equal(calls.presidio.length, 0);
    assert.equal(calls.horizon.length, 0);
  });
});

test('pre-aborted collection leaves all units unattempted and makes no requests', async () => {
  const controller = new AbortController();
  controller.abort();
  await withServers({ presidio: normal('p-v1'), horizon: normal('h-v1') }, async ({ urls, calls }) => {
    const error = await collectBundle({ plan: plan(), capabilities, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' }, signal: controller.signal }).catch(e => e);
    assert.equal(error.message, 'INTERRUPTED');
    assert.equal(error.bundle.runStatus, 'incomplete');
    assert.equal(analyzeBundle(error.bundle).coverage.presidio.detection.unattempted, 2);
    assert.equal(calls.presidio.length, 0);
    assert.equal(calls.horizon.length, 0);
  });
});

test('an abort during a live request returns sanitized incomplete evidence without later requests', async () => {
  const controller = new AbortController();
  await withServers({ presidio: () => {
    controller.abort();
    return { body: reply('description', 'PERSON', 'p-v1') };
  }, horizon: normal('h-v1') }, async ({ urls, calls }) => {
    const error = await collectBundle({ plan: plan(), capabilities, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' }, signal: controller.signal }).catch(e => e);
    assert.equal(error.message, 'INTERRUPTED');
    assert.equal(error.bundle.runStatus, 'incomplete');
    assert.equal(calls.presidio.length, 1);
    assert.equal(calls.horizon.length, 0);
    assert.equal(analyzeBundle(error.bundle).coverage.presidio.detection.unattempted, 1);
    assert.ok(!JSON.stringify(error.bundle).includes(secret));
  });
});

test('rejects unsafe copied metadata and capabilities before any request', async () => {
  await withServers({ presidio: normal('p-v1'), horizon: normal('h-v1') }, async ({ urls, calls }) => {
    const cases = [
      input => { input.detection[0].detectionCaseId = secret; },
      input => { input.detection[0].sourceIds[0] = secret; input.policy[0].id = secret; },
      input => { input.detection[0].familyId = secret; },
      input => { input.detection[0].strata[0].scenario = secret; },
      input => { input.detection[0].strata[0].provenanceId = secret; },
      input => { input.detection[0].strata[0].annotation = { target: secret }; },
      input => { input.policy[0].scenario = secret; },
      input => { input.policy[0].annotationStatus = secret; },
      input => { input.policy[0].expectedEntities = [secret]; },
      input => { input.policy[0].tokenCount = secret; },
    ];
    for (const mutate of cases) {
      const input = plan(); mutate(input);
      const error = await collectBundle({ plan: input, capabilities, urls,
        policyVersions: { presidio: 'p-v1', horizon: 'h-v1' } }).catch(e => e);
      assert.equal(error.message, 'INVALID_COLLECTION_CONFIG');
      assert.ok(!JSON.stringify(error).includes(secret));
    }
    for (const mutate of [
      c => { c.engines.horizon.mapping.TAX_ID = 'IT_FISCAL_CODE'; },
      c => { c.engines.presidio.mapping.PERSON = secret; },
      c => { c.engines.presidio.capabilities[secret] = { scope: 'test' }; },
    ]) {
      const configured = structuredClone(capabilities); mutate(configured);
      const error = await collectBundle({ plan: plan(), capabilities: configured, urls,
        policyVersions: { presidio: 'p-v1', horizon: 'h-v1' } }).catch(e => e);
      assert.equal(error.message, 'INVALID_COLLECTION_CONFIG');
    }
    assert.equal(calls.presidio.length, 0);
    assert.equal(calls.horizon.length, 0);
  });
});

test('never copies ad hoc raw metadata from frozen input into the bundle', async () => {
  const input = plan();
  input.detection[0].strata[0].note = secret;
  input.policy[0].note = secret;
  await withServers({ presidio: normal('p-v1'), horizon: normal('h-v1') }, async ({ urls }) => {
    const bundle = await collectBundle({ plan: input, capabilities, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' } });
    assert.ok(!JSON.stringify(bundle).includes(secret));
  });
});

test('accepts Horizon application labels from the real frozen capability map', async () => {
  const frozen = await loadCapabilities();
  await withServers({ presidio: normal('p-v1'), horizon: payload => {
    const { fieldId, text, allowedEntityTypes } = payload.fields[0];
    return { body: reply(fieldId, text === secret && !allowedEntityTypes.includes('EMAIL_ADDRESS') ?
      'EMAIL_ADDRESS' : null, 'h-v1') };
  } }, async ({ urls }) => {
    const bundle = await collectBundle({ plan: plan(), capabilities: frozen, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' } });
    assert.deepEqual(bundle.observations.horizon.detection.d1.categories, ['EMAIL_ADDRESS']);
    assert.deepEqual(bundle.observations.horizon.policy.p1.categories, ['EMAIL_ADDRESS']);
  });
});

test('pending-review corpus plan traverses loopback without inference or raw evidence', async () => {
  const input = await loadCorpus();
  const frozen = await loadCapabilities();
  await withServers({ presidio: payload => ({ body: reply(payload.fields[0].fieldId, null, 'p-v1') }),
    horizon: payload => ({ body: reply(payload.fields[0].fieldId, null, 'h-v1') }) },
  async ({ urls, calls }) => {
    const bundle = await collectBundle({ plan: input, capabilities: frozen, urls,
      policyVersions: { presidio: 'p-v1', horizon: 'h-v1' }, timeoutMs: 5000 });
    assert.equal(bundle.runStatus, 'complete');
    assert.equal(bundle.detectionUnits.length, input.detection.length);
    assert.equal(bundle.policyUnits.length, input.policy.length);
    assert.equal(bundle.policyUnits[0].split, 'development');
    assert.equal(bundle.policyUnits[0].familyId, input.policy[0].familyId);
    assert.equal(bundle.policyUnits[0].focusCategory, input.policy[0].focusCategory);
    assert.equal(calls.presidio.length, input.detection.length + input.policy.length);
    assert.equal(calls.horizon.length, input.detection.length + input.policy.length);
    assert.equal(analyzeBundle(bundle).coverage.horizon.policy.successes, input.policy.length);
    assert.ok(!JSON.stringify(bundle).includes(input.detection[0].text));
  });
});

test('known native extra labels remain diagnostic rather than inventing support', async () => {
  await withServers({ presidio: (payload, n) => n === 2 ?
    { body: reply('contactName', 'NRP', 'p-v1') } : normal('p-v1')(payload),
  horizon: normal('h-v1') }, async ({ urls }) => {
    const bundle = await run(urls);
    assert.deepEqual(bundle.observations.presidio.detection.d2.categories, ['NRP']);
    assert.deepEqual(analyzeBundle(bundle).diagnostics.extraLabels.presidio.detection,
      [{ id: 'd2', category: 'NRP' }]);
  });
});
