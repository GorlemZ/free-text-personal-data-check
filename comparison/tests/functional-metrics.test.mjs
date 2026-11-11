import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { analyzeBundle, validateReleaseBundle } from '../functional/metrics.mjs';
import { createBundle } from '../functional/collect.mjs';
import { loadCorpus } from '../functional/load-corpus.mjs';
import { loadCapabilities } from '../functional/config.mjs';

const bundle = () => ({
  schemaVersion: 1,
  runStatus: 'complete',
  capabilities: { categories: ['PERSON', 'EMAIL_ADDRESS'], engines: {
    presidio: { supportedCategories: ['PERSON'] },
    horizon: { supportedCategories: ['PERSON', 'EMAIL_ADDRESS'] },
  } },
  detectionUnits: [
    { id: 'd1', sourceIds: ['p1', 'p2'], fieldId: 'description', expectedEntities: ['PERSON'], focusCategory: 'PERSON', strata: [{ sourceId: 'p1', focusCategory: 'PERSON', scenario: 'corner' }, { sourceId: 'p2', focusCategory: 'PERSON', scenario: 'corner' }] },
    { id: 'd2', sourceIds: ['p3'], fieldId: 'description', expectedEntities: [], focusCategory: 'PERSON', strata: [{ sourceId: 'p3', focusCategory: 'PERSON', scenario: 'corner' }] },
  ],
  policyUnits: [
    { id: 'p1', detectionCaseId: 'd1', fieldId: 'description', expectedEntities: ['PERSON'], allowedEntityTypes: [], expectedVerdict: 'rejected' },
    { id: 'p2', detectionCaseId: 'd1', fieldId: 'contactName', expectedEntities: ['PERSON'], allowedEntityTypes: ['PERSON'], expectedVerdict: 'accepted' },
    { id: 'p3', detectionCaseId: 'd2', fieldId: 'description', expectedEntities: [], allowedEntityTypes: [], expectedVerdict: 'accepted' },
  ],
  observations: {
    presidio: { detection: { d1: { status: 200, categories: ['PERSON'] }, d2: { status: 200, categories: ['PERSON'] } }, policy: {
      p1: { status: 200, verdict: 'rejected', categories: ['PERSON'] },
      p2: { status: 200, verdict: 'accepted', categories: [] },
      p3: { status: 200, verdict: 'rejected', categories: ['PERSON'] },
    } },
    horizon: { detection: { d1: { status: 200, categories: [] }, d2: { status: 503 } }, policy: {
      p1: { status: 503 }, p2: { status: 200, verdict: 'accepted', categories: [] },
    } },
  },
});

test('scores independent own and paired probes and preserves unattempted units', () => {
  const s = analyzeBundle(bundle());
  assert.deepEqual(s.detection.own.presidio.byCategory.PERSON.counts, { tp: 1, fn: 0, fp: 1, tn: 0 });
  assert.deepEqual(s.detection.own.horizon.byCategory.PERSON.counts, { tp: 0, fn: 1, fp: 0, tn: 0 });
  assert.deepEqual(s.detection.paired.presidio.byCategory.PERSON.counts, { tp: 1, fn: 0, fp: 0, tn: 0 });
  assert.equal(s.detection.own.presidio.byCategory.EMAIL_ADDRESS, undefined);
  assert.deepEqual(s.detection.own.presidio.unsupported, []);
  assert.deepEqual(s.detection.own.presidio.unsampled, ['EMAIL_ADDRESS']);
  assert.equal(s.detection.own.horizon.byCategory.EMAIL_ADDRESS, undefined);
  assert.deepEqual(s.detection.own.horizon.unsampled, ['EMAIL_ADDRESS']);
  assert.deepEqual(s.policy.own.presidio.counts, { tp: 1, fn: 0, fp: 1, tn: 1 });
  assert.deepEqual(s.policy.own.horizon.counts, { tp: 0, fn: 0, fp: 0, tn: 1 });
  assert.deepEqual(s.policy.paired.presidio.counts, { tp: 0, fn: 0, fp: 0, tn: 1 });
  assert.deepEqual(s.coverage.horizon.policy, { planned: 3, attempted: 2, unattempted: 1, successes: 1, technicalErrors: 1, contractErrors: 0, pairedSuccesses: 1, pairedExclusions: 2 });
  assert.deepEqual(s.coverage.horizon.detection, { planned: 2, attempted: 2, unattempted: 0, successes: 1, technicalErrors: 1, contractErrors: 0, pairedSuccesses: 1, pairedExclusions: 1 });
  assert.equal(s.policy.own.presidio.accuracy, 2 / 3);
  assert.equal(s.policy.own.presidio.balancedAccuracy, .75);
  assert.equal(s.policy.operational.presidio, null);
  assert.equal(s.runStatus, 'incomplete');
});

test('complete run computes operational rates, zero-denominator nulls, macro and micro separately', () => {
  const b = bundle();
  b.observations.horizon.detection.d2 = { status: 200, categories: [] };
  b.observations.horizon.policy.p1 = { status: 200, categories: [], verdict: 'accepted' };
  b.observations.horizon.policy.p3 = { status: 200, categories: [], verdict: 'accepted' };
  const s = analyzeBundle(b);
  assert.equal(s.runStatus, 'complete');
  assert.equal(s.policy.operational.presidio, 2 / 3);
  assert.equal(s.policy.operational.horizon, 2 / 3);
  assert.equal(s.detection.own.horizon.operational.PERSON, .5);
  assert.equal(s.detection.own.horizon.byCategory.PERSON.specificity, 1);
  assert.equal(s.detection.own.horizon.byCategory.PERSON.precision, null);
  assert.equal(s.detection.own.horizon.macro.precision.included, 0);
  assert.equal(s.detection.own.horizon.micro.precision, null);
  assert.deepEqual(s.detection.own.presidio.focusCategory.PERSON.counts, { tp: 1, fn: 0, fp: 1, tn: 0 });
});

test('rejects broken frozen-plan links, gold, observation IDs, and malformed successful responses', () => {
  const mutations = [
    b => { b.detectionUnits[0].sourceIds = ['missing']; },
    b => { b.policyUnits[0].expectedVerdict = 'accepted'; },
    b => { b.policyUnits[0].detectionCaseId = 'd2'; },
    b => { b.observations.presidio.detection.unknown = { status: 200, categories: [] }; },
    b => { b.observations.presidio.detection.d1 = { status: 200 }; },
    b => { b.observations.presidio.policy.p1 = { status: 200, verdict: 'unknown', categories: [] }; },
    b => { b.observations.presidio.policy.p1 = { status: 200, verdict: 'accepted', categories: ['PERSON'] }; },
    b => { b.observations.presidio.detection.d1 = { status: 200, categories: ['PERSON', 'PERSON'] }; },
    b => { b.capabilities.engines.horizon.supportedCategories = ['UNMAPPED']; },
  ];
  for (const mutate of mutations) {
    const b = bundle(); mutate(b);
    assert.throws(() => analyzeBundle(b), /INVALID_BUNDLE/);
  }
});

test('gold arrays compare as sets and source strata deduplicate detection units', () => {
  const b = bundle();
  b.detectionUnits[0].expectedEntities = ['PERSON', 'EMAIL_ADDRESS'];
  b.policyUnits[0].expectedEntities = ['EMAIL_ADDRESS', 'PERSON'];
  b.policyUnits[1].expectedEntities = ['PERSON', 'EMAIL_ADDRESS'];
  b.policyUnits[1].allowedEntityTypes = ['EMAIL_ADDRESS', 'PERSON'];
  b.detectionUnits[0].strata = [
    { sourceId: 'p1', focusCategory: 'PERSON', scenario: 'corner' },
    { sourceId: 'p2', focusCategory: 'PERSON', scenario: 'corner' },
  ];
  delete b.detectionUnits[0].focusCategory;
  delete b.detectionUnits[1].focusCategory;
  const s = analyzeBundle(b);
  assert.equal(s.detection.own.presidio.byCategory.PERSON.counts.tp, 1);
  assert.equal(s.detection.own.presidio.focusCategory.PERSON.counts.tp, 1);
  assert.deepEqual(s.detection.own.presidio.strata.corner.byCategory.PERSON.counts, { tp: 1, fn: 0, fp: 1, tn: 0 });
});

test('sampled but unsupported categories are not scored as false negatives', () => {
  const b = bundle();
  b.capabilities.engines.presidio.supportedCategories = [];
  const s = analyzeBundle(b);
  assert.deepEqual(s.detection.own.presidio.unsupported, ['PERSON']);
  assert.deepEqual(s.detection.own.presidio.byCategory, {});
  assert.equal(s.detection.own.presidio.macro.recall.included, 0);
});

test('asymmetric errors never remove successful opposite probes; extra labels remain diagnostic', () => {
  const b = bundle();
  b.observations.presidio.detection.d2.categories = ['PERSON', 'NRP'];
  b.observations.presidio.policy.p3 = { status: 'timeout' };
  b.observations.horizon.policy.p1 = { status: 400 };
  const s = analyzeBundle(b);
  assert.equal(s.detection.own.presidio.byCategory.PERSON.counts.fp, 1);
  assert.equal(s.policy.own.presidio.counts.fp, 0);
  assert.equal(s.coverage.horizon.policy.contractErrors, 1);
  assert.deepEqual(s.diagnostics.extraLabels.presidio.detection, [{ id: 'd2', category: 'NRP' }]);
});

test('release validation rejects a self-consistent invented 1/1 complete run', () => {
  assert.throws(() => validateReleaseBundle(bundle()), /INVALID_BUNDLE/);
});

test('exact category sets and conditional policy errors use separate denominators', () => {
  const s = analyzeBundle(bundle());
  assert.deepEqual(s.detection.own.presidio.exactSet, { correct: 1, total: 2, accuracy: .5 });
  assert.deepEqual(s.detection.paired.presidio.exactSet, { correct: 1, total: 1, accuracy: 1 });
  assert.deepEqual(s.detection.own.horizon.exactSet, { correct: 0, total: 1, accuracy: 0 });
  assert.equal(s.policy.own.presidio.falseAcceptanceRate, 0);
  assert.equal(s.policy.own.presidio.falseRejectionRate, .5);
  assert.equal(s.policy.paired.horizon.falseAcceptanceRate, null);
});

test('standalone render preserves the historical catalog without reading current gold', () => {
  const b = bundle();
  b.runStatus = 'incomplete';
  const categories = ['PERSON', 'ORGANIZATION', 'LOCATION', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'CREDIT_CARD',
    'IP_ADDRESS', 'MAC_ADDRESS', 'URL', 'IT_FISCAL_CODE', 'IT_DRIVER_LICENSE', 'IT_IDENTITY_CARD',
    'IT_PASSPORT', 'IT_VAT_CODE', 'IBAN_CODE', 'CRYPTO', 'DATE_TIME', 'MEDICAL_LICENSE'];
  b.capabilities.categories = categories;
  b.capabilities.engines.presidio.supportedCategories = [...categories];
  b.capabilities.engines.horizon.supportedCategories = categories.filter(c =>
    !['IT_DRIVER_LICENSE', 'IT_IDENTITY_CARD', 'IT_PASSPORT', 'CRYPTO', 'DATE_TIME', 'MEDICAL_LICENSE'].includes(c));
  b.observations.presidio.detection.d2.categories = ['LOCATION'];
  assert.equal(validateReleaseBundle(b), b);
  assert.equal(analyzeBundle(b).legacyHistorical, true);
  assert.throws(() => validateReleaseBundle(b, { detection: [], policy: [] }), /INVALID_BUNDLE/);
});

test('unknown observation labels and unsafe metadata cannot reach JSON diagnostics', () => {
  for (const mutate of [
    b => { b.observations.presidio.detection.d1.categories = ['PERSON', '=PRIVATE_NAME']; },
    b => { b.detectionUnits[0].strata[0].scenario = '<script>alert(1)</script>'; },
    b => { b.detectionUnits[0].id = '=PRIVATE_NAME'; b.policyUnits[0].detectionCaseId = '=PRIVATE_NAME'; b.policyUnits[1].detectionCaseId = '=PRIVATE_NAME'; },
    b => { b.detectionUnits[0].fieldId = 'private address'; },
  ]) {
    const b = bundle(); mutate(b);
    assert.throws(() => analyzeBundle(b), /INVALID_BUNDLE/);
  }
});

test('known Horizon native extras remain diagnostic but cross-engine and invented labels fail', () => {
  const b = bundle();
  b.observations.horizon.detection.d1.categories = ['ACCOUNT_ID'];
  assert.deepEqual(analyzeBundle(b).diagnostics.extraLabels.horizon.detection,
    [{ id: 'd1', category: 'ACCOUNT_ID' }]);
  b.observations.presidio.detection.d1.categories = ['ACCOUNT_ID'];
  assert.throws(() => analyzeBundle(b), /INVALID_BUNDLE/);
});

test('unattempted observations cannot smuggle contradictory response data', () => {
  for (const observation of [
    { status: 'unattempted', categories: ['PERSON'] },
    { status: 'unattempted', verdict: 'rejected' },
    { status: 'unattempted', rawText: 'private' },
  ]) {
    const b = bundle(); b.observations.horizon.policy.p3 = observation;
    assert.throws(() => analyzeBundle(b), /INVALID_BUNDLE/);
  }
});

async function releaseFixture() {
  const plan = await loadCorpus();
  const capabilities = await loadCapabilities();
  const b = createBundle(plan, capabilities);
  b.runStatus = 'incomplete';
  return { b, plan };
}

test('standalone release gate accepts sanitized results without hashes or corpus input', async () => {
  const { b } = await releaseFixture();
  assert.equal(validateReleaseBundle(b), b);
});

test('live collection validates expected gold and links directly without hashes', async () => {
  const { b, plan } = await releaseFixture();
  for (const mutate of [
    x => {
      const d = x.detectionUnits[0];
      d.expectedEntities = d.expectedEntities.includes('PERSON') ? [] : ['PERSON'];
      for (const p of x.policyUnits.filter(p => d.sourceIds.includes(p.id))) {
        p.expectedEntities = [...d.expectedEntities];
        p.expectedVerdict = p.expectedEntities.some(c => !p.allowedEntityTypes.includes(c)) ? 'rejected' : 'accepted';
      }
    },
    x => {
      const d = x.detectionUnits[0];
      d.id = 'invented-detection';
      for (const p of x.policyUnits.filter(p => d.sourceIds.includes(p.id))) p.detectionCaseId = d.id;
    },
  ]) {
    const altered = structuredClone(b);
    mutate(altered);
    assert.doesNotThrow(() => analyzeBundle(altered));
    assert.throws(() => validateReleaseBundle(altered, plan), /INVALID_BUNDLE/);
  }
});

test('standalone gate reads only sanitized results.json from isolated working directory', async () => {
  const { b } = await releaseFixture();
  const dir = mkdtempSync(join(tmpdir(), 'offline-release-'));
  try {
    writeFileSync(join(dir, 'results.json'), JSON.stringify(b));
    const metrics = fileURLToPath(new URL('../functional/metrics.mjs', import.meta.url));
    const script = `import { readFileSync } from 'node:fs';
      import { pathToFileURL } from 'node:url';
      const { validateReleaseBundle } = await import(pathToFileURL(process.argv[1]).href);
      const bundle = JSON.parse(readFileSync('results.json', 'utf8'));
      validateReleaseBundle(bundle);
      process.stdout.write('VALID');`;
    assert.equal(execFileSync(process.execPath, ['--input-type=module', '-e', script, metrics],
      { cwd: dir, encoding: 'utf8' }), 'VALID');
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('release gate accepts the loaded gold and rejects mismatched cases', async () => {
  const { b, plan } = await releaseFixture();
  assert.equal(validateReleaseBundle(b, plan), b);
  for (const mutate of [
    x => { x.detectionUnits.pop(); },
    x => { x.policyUnits.pop(); },
    x => { x.capabilities.categories[0] = 'INVENTED'; },
    x => { x.capabilities.engines.horizon.supportedCategories.pop(); },
    x => { x.policyUnits[0].fieldId = 'secret'; },
    x => { x.runStatus = 'complete'; },
    x => { x.detectionUnits[0].id = 'invented'; x.policyUnits.filter(p => x.detectionUnits[0].sourceIds.includes(p.id)).forEach(p => { p.detectionCaseId = 'invented'; }); },
  ]) {
    const altered = structuredClone(b); mutate(altered);
    assert.throws(() => validateReleaseBundle(altered, plan), /INVALID_BUNDLE/);
  }
});

test('loaded gold rejects a type-valid extra focus that would alter focal scoring', async () => {
  const { b, plan } = await releaseFixture();
  b.detectionUnits[0].focusCategory = 'EMAIL_ADDRESS';
  assert.doesNotThrow(() => analyzeBundle(b));
  assert.throws(() => validateReleaseBundle(b, plan), /INVALID_BUNDLE/);
});

test('catalog-exact matching excludes extra labels but keeps them diagnostic', () => {
  const b = bundle();
  b.observations.presidio.detection.d1.categories.push('NRP');
  const s = analyzeBundle(b);
  assert.deepEqual(s.detection.paired.presidio.exactSet, { correct: 1, total: 1, accuracy: 1 });
  assert.deepEqual(s.diagnostics.extraLabels.presidio.detection, [{ id: 'd1', category: 'NRP' }]);
});

test('release gate rejects raw payload keys and malformed metadata without hashes',async()=>{
 const {b}=await releaseFixture();
 for(const mutate of [x=>x.text='PRIVATE', x=>x.detectionUnits[0].text='PRIVATE',
 x=>x.policyUnits[0].rawBody='PRIVATE', x=>x.detectionUnits[0].strata[0].annotation.rationale='PRIVATE',
 x=>x.detectionUnits[0].tokenCount=-1]){
  const changed=structuredClone(b);mutate(changed);assert.throws(()=>validateReleaseBundle(changed),/INVALID_BUNDLE/);
 }
});
