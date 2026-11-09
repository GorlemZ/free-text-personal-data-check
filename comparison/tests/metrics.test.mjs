import { test } from 'node:test';
import assert from 'node:assert/strict';
import { analyzeResults, validateCorpus } from '../metrics.mjs';

const sample = (overrides = {}) => ({ id: 'synthetic-01', fieldId: 'description',
  text: 'Testo sintetico.', allowedEntityTypes: [], expectedEntities: [],
  expectedVerdict: 'accepted', ...overrides });
const ok = (verdict, labels = []) => ({ status: 200, body: { verdict,
  modelPolicyVersion: 'synthetic-policy',
  findings: labels.map(entityType => ({ fieldId: 'description', entityType })) } });
const result = (id, detector, policy) => ({ id, detector, policy });

test('an allowlisted true entity is counted from the unfiltered detector probe', () => {
  const corpus = [sample({ text: 'Utente: Ada Verdi', allowedEntityTypes: ['PERSON'],
    expectedEntities: ['PERSON'] })];
  const report = analyzeResults(corpus, [result(corpus[0].id,
    ok('rejected', ['PERSON']), ok('accepted'))], new Set(['PERSON']));
  assert.equal(report.byCategory.PERSON.tp, 1);
  assert.equal(report.byCategory.PERSON.fn, 0);
  assert.equal(report.verdict.tn, 1);
  assert.equal(report.samples.completed, 1);
});

test('extra native labels remain diagnostic and can cause a verdict false positive', () => {
  const corpus = [sample()];
  const report = analyzeResults(corpus, [result(corpus[0].id,
    ok('rejected', ['VEHICLE_ID']), ok('rejected', ['VEHICLE_ID']))], new Set(['PERSON']));
  assert.equal(report.byCategory.PERSON.tn, 1);
  assert.equal(report.verdict.fp, 1);
  assert.deepEqual(report.diagnostics[0].extraLabels, ['VEHICLE_ID']);
  assert.ok(!JSON.stringify(report).includes('Testo sintetico'));
});

test('unsupported categories are not false negatives and technical errors are excluded', () => {
  const corpus = [sample({ id: 'only-unsupported', expectedEntities: ['IBAN_CODE'],
    expectedVerdict: 'rejected' }), sample({ id: 'unavailable', text: 'SENTINELSECRET' })];
  const report = analyzeResults(corpus, [result('only-unsupported', ok('accepted'), ok('accepted')),
    result('unavailable', ok('rejected', ['PERSON']),
      { status: 503, body: { code: 'ANALYZER_UNAVAILABLE' } })], new Set(['PERSON']));
  assert.ok(report.unsupported.includes('IBAN_CODE'));
  assert.ok(!report.unsupported.includes('PERSON'));
  assert.equal(report.byCategory.PERSON.fn, 0);
  assert.equal(report.byCategory.PERSON.attempted, 2);
  assert.equal(report.byCategory.PERSON.completed, 1);
  assert.deepEqual(report.samples, { attempted: 2, completed: 1, technicalErrors: 1 });
  assert.equal(report.verdict.fn, 1);
  assert.ok(!JSON.stringify(report).includes('SENTINELSECRET'));
});

test('corpus rejects duplicate IDs, unknown categories and invalid expected verdicts', () => {
  for (const corpus of [[sample(), sample()], [sample({ expectedEntities: ['TAX_ID'] })],
    [sample({ expectedVerdict: 'unknown' })], [sample({ extra: 'forbidden' })]]) {
    assert.throws(() => validateCorpus(corpus), { message: 'INVALID_CORPUS' });
  }
});

test('metrics refuse findings attributed to a different field or an allowlisted policy category', () => {
  const corpus = [sample({ allowedEntityTypes: ['PERSON'], expectedEntities: ['PERSON'] })];
  for (const bad of [result(corpus[0].id,
    { status: 200, body: { ...ok('rejected', ['PERSON']).body,
      findings: [{ fieldId: 'contactName', entityType: 'PERSON' }] } }, ok('accepted')),
  result(corpus[0].id, ok('rejected', ['PERSON']), ok('rejected', ['PERSON']))]) {
    assert.throws(() => analyzeResults(corpus, [bad], new Set(['PERSON'])),
      { message: 'INVALID_RESULTS' });
  }
});
