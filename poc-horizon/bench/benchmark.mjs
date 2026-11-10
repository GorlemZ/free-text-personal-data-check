import { readFile } from 'node:fs/promises';
import { performance } from 'node:perf_hooks';
import { prepare, inferPrepared, MODEL_POLICY_VERSION } from '../src/detector.mjs';
import { categoriesOf, CATEGORIES, SCORE_THRESHOLD } from '../src/categories.mjs';
import { recognizeItalianIdentifiers } from '../dist/recognizers/registry.mjs';
import { analyzeFields } from '../dist/analysis/analyze-fields.mjs';

const monitored = ['PERSON','EMAIL_ADDRESS','IT_FISCAL_CODE','PHONE_NUMBER',
  'IBAN_CODE','IT_VAT_CODE','DATE_TIME','ORGANIZATION','LOCATION'];
const empty = () => ({ tp: 0, fp: 0, fn: 0, tn: 0, denominator: 0 });
function tally(count, actual, predicted, labels) {
  for (const label of labels) {
    if (actual.has(label) && predicted.has(label)) count.tp++;
    else if (predicted.has(label)) count.fp++;
    else if (actual.has(label)) count.fn++;
    else count.tn++;
    count.denominator++;
  }
}
function rates(c) {
  return { ...c, precision: c.tp + c.fp ? c.tp/(c.tp+c.fp) : null,
    recall: c.tp + c.fn ? c.tp/(c.tp+c.fn) : null };
}
function percentile(values, n) {
  if (!values.length) return null;
  return +[...values].sort((a,b)=>a-b)[Math.ceil(n*values.length)-1].toFixed(3);
}
export async function evaluate(samples, threshold = SCORE_THRESHOLD,
                               infer = inferPrepared,
                               { prepare: preflight = prepare, recognize = recognizeItalianIdentifiers } = {}) {
  const detector = empty(), policy = empty();
  const commonDetector = empty(), commonPolicy = empty();
  const common = monitored.filter(x=>CATEGORIES.has(x));
  const byCategory = Object.fromEntries(monitored.map(k=>[k, empty()]));
  const bySplit = Object.fromEntries(['calibration','evaluation'].map(k=>[k,{detector:empty(),policy:empty()}]));
  const splits = {calibration:0,evaluation:0}, falseNegativeDiagnosis = {belowThreshold:0,noCandidate:0};
  const latency = [];
  let technicalErrors = 0, unsupportedExpected = 0;
  for (const sample of samples) {
    splits[sample.split]++;
    const start = performance.now();
    let predicted, possible;
    try {
      const [analysis] = await analyzeFields([{
        fieldId: sample.fieldId, text: sample.text, allowedEntityTypes: sample.allowedEntityTypes,
      }], { prepare: preflight, infer: prepared => infer(prepared) },
      recognize, categoriesOf, threshold);
      predicted = analysis.detected;
      possible = analysis.possible;
    }
    catch { technicalErrors++; continue; }
    latency.push(performance.now()-start);
    const expected = new Set(sample.expectedEntities), allowed = new Set(sample.allowedEntityTypes);
    unsupportedExpected += [...expected].filter(x=>!CATEGORIES.has(x)).length;
    for (const missing of expected) if (!predicted.has(missing))
      falseNegativeDiagnosis[possible.has(missing)?'belowThreshold':'noCandidate']++;
    for (const category of monitored) tally(byCategory[category],expected,predicted,[category]);
    tally(detector,expected,predicted,monitored);
    tally(commonDetector,expected,predicted,common);
    tally(bySplit[sample.split].detector,expected,predicted,monitored);
    const denied = new Set([...expected].filter(x=>!allowed.has(x)));
    const observedDenied = new Set([...predicted].filter(x=>!allowed.has(x)));
    const truth = denied.size?new Set(['reject']):new Set();
    const guess = observedDenied.size?new Set(['reject']):new Set();
    tally(policy,truth,guess,['reject']);
    const commonTruth = new Set([...denied].filter(x=>CATEGORIES.has(x)));
    const commonGuess = new Set([...observedDenied].filter(x=>CATEGORIES.has(x)));
    tally(commonPolicy,commonTruth.size?new Set(['reject']):new Set(),
      commonGuess.size?new Set(['reject']):new Set(),['reject']);
    tally(bySplit[sample.split].policy,truth,guess,['reject']);
  }
  return { modelPolicyVersion:MODEL_POLICY_VERSION, threshold, samples:samples.length, splits,
    technicalErrors, unsupportedMonitored:monitored.filter(x=>!CATEGORIES.has(x)),
    unsupportedExpected, commonCategories:common, commonDetector:rates(commonDetector),
    commonPolicy:rates(commonPolicy),
    detector:rates(detector), byCategory:Object.fromEntries(Object.entries(byCategory).map(([k,v])=>[k,rates(v)])),
    bySplit:Object.fromEntries(Object.entries(bySplit).map(([k,v])=>[k,{detector:rates(v.detector),policy:rates(v.policy)}])),
    policy:rates(policy), falseNegativeDiagnosis,
    latencyMs:{p50:percentile(latency,.5),p95:percentile(latency,.95),p99:percentile(latency,.99),completed:latency.length},
  };
}
if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  const samples = JSON.parse(await readFile(new URL('./corpus.json', import.meta.url),'utf8'));
  console.log(JSON.stringify(await evaluate(samples)));
}
