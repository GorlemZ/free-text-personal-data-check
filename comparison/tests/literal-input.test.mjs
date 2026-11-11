import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCorpus, requestFor } from '../functional/load-corpus.mjs';

const corpusUrl = new URL('../corpus.json', import.meta.url);
const goldUrl = new URL('../gold.json', import.meta.url);

test('detector inputs are only complete literal strings; annotations live separately', async () => {
  const texts = JSON.parse(await readFile(corpusUrl, 'utf8'));
  assert.ok(Array.isArray(texts) && texts.length > 0);
  assert.ok(texts.every(text => typeof text === 'string' && text.trim() === text && text.length > 0));
  assert.equal(new Set(texts).size, texts.length);
  const gold = JSON.parse(await readFile(goldUrl, 'utf8'));
  assert.ok(gold.every(row => !Object.hasOwn(row, 'text') && Number.isInteger(row.textIndex)));
  const plan = await loadCorpus();
  assert.equal(plan.detection.length, texts.length);
  for (const [index, sample] of plan.detection.entries()) {
    assert.equal(sample.text, texts[index]);
    assert.equal(requestFor(sample).fields[0].text, texts[index]);
  }
  for (const sample of plan.policy) {
    assert.equal(requestFor(sample).fields[0].text, texts[sample.textIndex]);
  }
});
