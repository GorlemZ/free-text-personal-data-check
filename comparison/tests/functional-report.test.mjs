import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeBundle } from '../functional/metrics.mjs';
import { renderReport } from '../functional/report.mjs';

const bundle = {
  schemaVersion: 1, runStatus: 'complete',
  capabilities: { categories: ['PERSON'], engines: {
    presidio: { supportedCategories: ['PERSON'] }, horizon: { supportedCategories: ['PERSON'] },
  } },
  detectionUnits: [
    { id: 'd1', sourceIds: ['p1'], fieldId: 'description', expectedEntities: ['PERSON'], focusCategory: 'PERSON' },
    { id: 'd2', sourceIds: ['p2'], fieldId: 'description', expectedEntities: [], focusCategory: 'PERSON' },
  ],
  policyUnits: [
    { id: 'p1', detectionCaseId: 'd1', fieldId: 'description', expectedEntities: ['PERSON'], allowedEntityTypes: [], expectedVerdict: 'rejected' },
    { id: 'p2', detectionCaseId: 'd2', fieldId: 'description', expectedEntities: [], allowedEntityTypes: [], expectedVerdict: 'accepted' },
  ],
  observations: Object.fromEntries(['presidio', 'horizon'].map(e => [e, {
    detection: { d1: { status: 200, categories: e === 'presidio' ? ['PERSON'] : [] }, d2: { status: 200, categories: [] } },
    policy: { p1: { status: 200, verdict: e === 'presidio' ? 'rejected' : 'accepted', categories: e === 'presidio' ? ['PERSON'] : [] },
      p2: { status: 200, verdict: 'accepted', categories: [] } },
  }])),
};

test('deterministic sanitized Markdown CSV JSON serializations have aligned denominators', () => {
  const summary = analyzeBundle(bundle);
  const output = renderReport(summary);
  assert.deepEqual(JSON.parse(output.summaryJson), summary);
  assert.equal(renderReport(summary).markdown, output.markdown);
  assert.match(output.markdown, /Categoria \| N\+ \/ N− appaiati/);
  assert.match(output.markdown, /PERSON \| 1 \/ 1 \| 100\.0% \| 0\.0%/);
  assert.match(output.markdown, /Motore \| N policy \| Rifiuti corretti/);
  assert.match(output.sensitivityCsv, /paired,presidio,PERSON,1,1,1,0,0,1/);
  assert.match(output.verdictCsv, /paired,horizon,2,0,1,0,1/);
  assert.doesNotMatch(Object.values(output).join(''), /description|p1|d1|undefined|NaN/);
});

test('renders null denominators as blank CSV and N/A Markdown, and incomplete banner', () => {
  const b = structuredClone(bundle);
  b.observations.horizon.detection = {};
  b.observations.horizon.policy = {};
  const output = renderReport(analyzeBundle(b));
  assert.match(output.markdown, /INCOMPLETE/);
  assert.match(output.markdown, /N\/A/);
  assert.match(output.sensitivityCsv, /paired,horizon,PERSON,0,0,0,0,0,0,,,,,,/);
  assert.equal(JSON.parse(output.summaryJson).policy.paired.horizon.accuracy, null);
});

test('CSV parses into canonical cells with no injected formulas or line breaks', () => {
  const output = renderReport(analyzeBundle(bundle));
  const rows = output.sensitivityCsv.trimEnd().split('\n').map(line => line.split(','));
  assert.deepEqual(rows[0], ['cohort', 'engine', 'category', 'positive', 'negative', 'tp', 'fn', 'fp', 'tn',
    'recall', 'precision', 'specificity', 'f1', 'accuracy', 'balancedAccuracy']);
  assert.deepEqual(rows.map(row => row.length), [15, 15, 15, 15, 15]);
  assert.deepEqual(rows.find(row => row[0] === 'paired' && row[1] === 'presidio').slice(0, 9),
    ['paired', 'presidio', 'PERSON', '1', '1', '1', '0', '0', '1']);
});

test('report includes both probe coverage, correct acceptances and conditional policy errors', () => {
  const output = renderReport(analyzeBundle(bundle));
  assert.match(output.markdown, /Accettazioni corrette/);
  assert.match(output.markdown, /Accettazioni indebite \/ attesi rifiutati/);
  assert.match(output.markdown, /Rifiuti indebiti \/ attesi accettati/);
  assert.match(output.markdown, /Set categorie esatto nel catalogo/);
  assert.match(output.markdown, /presidio \| detection \| 2 \| 2 \| 2 \| 0 \| 0 \| 0/);
  assert.match(output.verdictCsv.split('\n')[0], /falseAcceptanceRate,falseRejectionRate/);
  assert.doesNotMatch(output.markdown, /including extra labels outside the scored detection categories/);
});

test('report rejects untrusted and mutated summaries before serializing raw labels', () => {
  const summary = analyzeBundle(bundle);
  summary.diagnostics.extraLabels.presidio.detection.push({ id: 'd1', category: '=PRIVATE' });
  assert.throws(() => renderReport(summary), /INVALID_SUMMARY/);
  const forged = structuredClone(analyzeBundle(bundle));
  forged.detection.paired.presidio.byCategory['<img src=x onerror=alert(1)>'] =
    forged.detection.paired.presidio.byCategory.PERSON;
  assert.throws(() => renderReport(forged), /INVALID_SUMMARY/);
});
