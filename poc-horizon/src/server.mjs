import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CATEGORIES, categoriesOf, SCORE_THRESHOLD } from './categories.mjs';
import { recognizeItalianIdentifiers } from '../dist/recognizers/registry.mjs';
import { analyzeFields } from '../dist/analysis/analyze-fields.mjs';
import { prepare, inferPrepared, getDetector } from './detector.mjs';
import { strictParse } from './strict-json.mjs';

const MAX_BODY_BYTES = 1048576;
const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
const invalid = () => { throw new InvalidRequest(); };
class InvalidRequest extends Error {}
class BodyTooLarge extends Error {}
function validate(body) {
  const payload = strictParse(body);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
    Object.keys(payload).join() !== 'fields' || !Array.isArray(payload.fields) ||
    payload.fields.length < 1 || payload.fields.length > 10) invalid();
  const ids = new Set();
  for (const field of payload.fields) {
    if (!field || Array.isArray(field) || typeof field !== 'object' ||
      Object.keys(field).some(key => !['allowedCategories', 'fieldId', 'text'].includes(key)) ||
      typeof field.fieldId !== 'string' || field.fieldId.length < 1 ||
      field.fieldId.length > 128 || ids.has(field.fieldId) ||
      typeof field.text !== 'string' ||
      field.text.split(/\p{White_Space}+/u).filter(Boolean).length > 50 ||
      ('allowedCategories' in field && (!Array.isArray(field.allowedCategories) ||
      field.allowedCategories.some(x => typeof x !== 'string' || !CATEGORIES.has(x))))) invalid();
    ids.add(field.fieldId);
  }
  return payload.fields;
}
function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
export function createHandler({ infer = inferPrepared, prepare: preflight = prepare,
  recognize = recognizeItalianIdentifiers, ready = getDetector, onQueued = () => {} } = {}) {
  let pending = 0;
  let tail = Promise.resolve();
  // A single inference at a time; up to four requests including the running one.
  async function queued(task) {
    if (pending >= 4) throw new Error('busy');
    pending++;
    const job = tail.then(task);
    tail = job.catch(() => {});
    try {
      onQueued(pending); // Test-only observer; no request content or result.
      return await job;
    } finally { pending--; }
  }
  return async (req, res) => {
    if (req.method === 'GET' && req.url === '/health/ready') {
      try { await ready(); reply(res, 200, { status: 'ready' }); }
      catch { reply(res, 503, { code: 'detector_unavailable' }); }
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/analyze') {
      reply(res, 404, { code: 'not_found' }); return;
    }
    if ((req.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
      req.resume(); reply(res, 400, { code: 'invalid_request' }); return;
    }
    let fields;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) throw new BodyTooLarge();
        chunks.push(chunk);
      }
      fields = validate(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
    } catch (error) {
      req.resume();
      reply(res, error instanceof BodyTooLarge ? 413 : 400,
        { code: error instanceof BodyTooLarge ? 'body_too_large' : 'invalid_request' }); return;
    }
    try {
      const findings = await queued(async () => {
        const analyses = await analyzeFields(fields, {
          prepare: preflight,
          infer: prepared => infer(prepared),
        }, recognize, categoriesOf, SCORE_THRESHOLD);
        return analyses.flatMap(({ fieldId, denied }) => [...denied]
          .map(category => ({ fieldId, category })))
          .sort((a, b) => compare(a.fieldId, b.fieldId) || compare(a.category, b.category));
      });
      reply(res, 200, {
        verdict: findings.length ? 'rejected' : 'accepted',
        findings,
      });
    } catch { reply(res, 503, { code: 'detector_unavailable' }); }
  };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await getDetector(); // fail before accepting requests
    const server = createServer(createHandler());
    server.requestTimeout = 10000;
    server.listen(Number(process.env.ANALYZER_PORT ?? 8000),
      process.env.ANALYZER_BIND_HOST ?? '127.0.0.1');
  } catch {
    console.error('detector_unavailable');
    process.exitCode = 1;
  }
}
