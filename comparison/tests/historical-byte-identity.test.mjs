import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { analyzeBundle, validateReleaseBundle } from '../functional/metrics.mjs';
import { renderReport } from '../functional/report.mjs';
const folders=['http-gold-2026-11-11-run-01','historical/functional-report-run-1','historical/functional-report-run-2'];
for (const folder of folders) test(`v1 published report bytes remain unchanged: ${folder}`,async()=>{
  const base=new URL(`../reports/${folder}/`,import.meta.url);
  const results=JSON.parse(await readFile(new URL('results.json',base),'utf8'));
  validateReleaseBundle(results);
  const rendered=renderReport(analyzeBundle(results));
  for (const [filename,key] of Object.entries({'summary.json':'summaryJson','sensitivity.csv':'sensitivityCsv','verdict.csv':'verdictCsv','report.md':'markdown'}))
    assert.equal(rendered[key],await readFile(new URL(filename,base),'utf8'),filename);
});
