// Pure serializers; caller owns atomic, no-overwrite file persistence.
import { isVerifiedSummary } from './metrics.mjs';
const engines = ['presidio', 'horizon'];
const cohorts = ['own', 'paired'];
const percent = n => n === null ? 'N/A' : `${(n * 100).toFixed(1)}%`;
const csvCell = value => {
  if (value === null || value === undefined) return '';
  const text = String(value);
  const inert = /^[\s\x00-\x1f]*[=+@-]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(inert) ? `"${inert.replaceAll('"', '""')}"` : inert;
};
const csv = rows => rows.map(row => row.map(csvCell).join(',')).join('\n') + '\n';
const safe = text => String(text).replace(/[\r\n\x00-\x1f]/g, ' ').replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '\\|');

/** renderReport(analyzeBundle(bundle)) -> four strings, no I/O or raw corpus. */
export function renderReport(summary) {
  if (!isVerifiedSummary(summary) || summary?.schemaVersion !== 1 || !summary.detection?.paired || !summary.policy?.paired)
    throw new Error('INVALID_SUMMARY');
  const detectionColumns = ['cohort', 'engine', 'category', 'positive', 'negative', 'tp', 'fn', 'fp', 'tn',
    'recall', 'precision', 'specificity', 'f1', 'accuracy', 'balancedAccuracy'];
  const verdictColumns = ['cohort', 'engine', 'n', 'tp', 'fn', 'fp', 'tn',
    'recall', 'precision', 'specificity', 'f1', 'accuracy', 'balancedAccuracy', 'technicalErrors', 'contractErrors', 'unattempted', 'falseAcceptanceRate', 'falseRejectionRate'];
  const sensitivity = [detectionColumns];
  const verdict = [verdictColumns];
  for (const cohort of cohorts) for (const engine of engines) {
    for (const [category, metrics] of Object.entries(summary.detection[cohort][engine].byCategory).sort(([a], [b]) => a.localeCompare(b))) {
      const { counts: c } = metrics;
      sensitivity.push([cohort, engine, category, metrics.positive, metrics.negative, c.tp, c.fn, c.fp, c.tn,
        ...detectionColumns.slice(9).map(k => metrics[k])]);
    }
    const metrics = summary.policy[cohort][engine];
    const { counts: c } = metrics;
    const coverage = summary.coverage[engine].policy;
    verdict.push([cohort, engine, metrics.positive + metrics.negative, c.tp, c.fn, c.fp, c.tn,
      ...verdictColumns.slice(7, 13).map(k => metrics[k]),
      coverage.technicalErrors, coverage.contractErrors, coverage.unattempted, metrics.falseAcceptanceRate, metrics.falseRejectionRate]);
  }
  const lines = [
    `# Functional comparison — ${summary.runStatus === 'complete' ? 'COMPLETE' : 'INCOMPLETE'}`,
    '',
    'Development sample; correlated policy scenarios. Delta is arithmetic, not statistical significance.',
    ...(summary.historicalCatalog ? ['Historical catalog: these results do not measure the current seven-category gold.'] : []),
    '',
    '| Categoria | N+ / N− appaiati | Recall Presidio | Recall Horizon | Precisione P/H | FP/FN P/H | Δ recall |',
    '| --- | --- | --- | --- | --- | --- | --- |',
  ];
  const p = summary.detection.paired.presidio.byCategory;
  const h = summary.detection.paired.horizon.byCategory;
  for (const category of [...new Set([...Object.keys(p), ...Object.keys(h)])].sort()) {
    const a = p[category], b = h[category];
    const counts = a ?? b;
    lines.push(`| ${safe(category)} | ${counts.positive} / ${counts.negative} | ${a ? percent(a.recall) : 'N/A'} | ${b ? percent(b.recall) : 'N/A'} | ${a ? percent(a.precision) : 'N/A'} / ${b ? percent(b.precision) : 'N/A'} | ${a ? `${a.counts.fp}/${a.counts.fn}` : 'N/A'} / ${b ? `${b.counts.fp}/${b.counts.fn}` : 'N/A'} | ${a?.recall != null && b?.recall != null ? percent(b.recall - a.recall) : 'N/A'} |`);
  }
  lines.push('', '| Motore | N policy | Rifiuti corretti | Accettazioni corrette | Accettazioni indebite | Rifiuti indebiti | Accuracy | Balanced accuracy | Errori |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const engine of engines) {
    const m = summary.policy.paired[engine];
    const errors = summary.coverage[engine].policy;
    lines.push(`| ${engine} | ${m.positive + m.negative} | ${m.counts.tp} | ${m.counts.tn} | ${m.counts.fn} | ${m.counts.fp} | ${percent(m.accuracy)} | ${percent(m.balancedAccuracy)} | ${errors.technicalErrors + errors.contractErrors} (non tentate ${errors.unattempted}) |`);
  }
  lines.push('', '| Motore | Accettazioni indebite / attesi rifiutati | Rifiuti indebiti / attesi accettati | Set categorie esatto nel catalogo (detection) |',
    '| --- | --- | --- | --- |');
  for (const engine of engines) {
    const m = summary.policy.paired[engine];
    const exact = summary.detection.paired[engine].exactSet;
    lines.push(`| ${engine} | ${m.counts.fn}/${m.positive} (${percent(m.falseAcceptanceRate)}) | ${m.counts.fp}/${m.negative} (${percent(m.falseRejectionRate)}) | ${exact.correct}/${exact.total} (${percent(exact.accuracy)}) |`);
  }
  lines.push('', '| Motore | Probe | Pianificate | Tentate | Riuscite | Errori tecnici | Errori contratto | Non tentate |',
    '| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const engine of engines) for (const probe of ['detection', 'policy']) {
    const c = summary.coverage[engine][probe];
    lines.push(`| ${engine} | ${probe} | ${c.planned} | ${c.attempted} | ${c.successes} | ${c.technicalErrors} | ${c.contractErrors} | ${c.unattempted} |`);
  }
  const extra = engines.reduce((n, engine) => n + ['detection', 'policy'].reduce((m, probe) =>
    m + summary.diagnostics.extraLabels[engine][probe].length, 0), 0);
  lines.push('', 'Paired denominators include only IDs with successful responses from both engines. Own-engine and paired counts, excluded probes, and zero-denominator nulls are in CSV/JSON.',
    'Policy positive = rejected. Accuracy and exact category-set correctness measure different outcomes. Technical errors are excluded from TP/FP/FN/TN.',
    `Out-of-catalog findings: ${extra}. For the current seven-category contract these indicate an application-policy discrepancy; historical bundles retain their original catalog.`, '');
  return { summaryJson: JSON.stringify(summary, null, 2) + '\n',
    sensitivityCsv: csv(sensitivity), verdictCsv: csv(verdict), markdown: lines.join('\n') };
}
