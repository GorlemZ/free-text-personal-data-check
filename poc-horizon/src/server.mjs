import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { CATEGORIES, detectedCategories } from './categories.mjs';
import { detect, getDetector, MODEL_POLICY_VERSION } from './detector.mjs';
import { strictParse } from './strict-json.mjs';

const MAX_BODY_BYTES = 32768;
const FIELD_IDS = new Set([
  'description', 'contactName', 'serverUrls[].description', 'eserviceName',
  'eserviceDescription', 'intendedTarget', 'purposeDescription',
  'freeOfChargeReason', 'riskAnalysisAnswer', 'consumerNotes', 'rejectAgreementReason',
]);
const invalid = () => { throw new InvalidRequest(); };
class InvalidRequest extends Error {}
function validate(body) {
  const payload = strictParse(body);
  if (!payload || Array.isArray(payload) || typeof payload !== 'object' ||
    Object.keys(payload).join() !== 'fields' || !Array.isArray(payload.fields) ||
    payload.fields.length < 1 || payload.fields.length > 16) invalid();
  const ids = new Set();
  for (const field of payload.fields) {
    if (!field || Array.isArray(field) || typeof field !== 'object' ||
      Object.keys(field).sort().join() !== 'allowedEntityTypes,fieldId,text' ||
      !FIELD_IDS.has(field.fieldId) || ids.has(field.fieldId) ||
      typeof field.text !== 'string' || [...field.text].length > 2000 ||
      Buffer.byteLength(field.text, 'utf8') > 8000 ||
      !Array.isArray(field.allowedEntityTypes) || field.allowedEntityTypes.length > CATEGORIES.size ||
      field.allowedEntityTypes.some(x => typeof x !== 'string' || !CATEGORIES.has(x)) ||
      new Set(field.allowedEntityTypes).size !== field.allowedEntityTypes.length) invalid();
    ids.add(field.fieldId);
  }
  return payload.fields;
}
function reply(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json', 'X-Content-Type-Options': 'nosniff' });
  res.end(JSON.stringify(payload));
}
export function createHandler({ infer = detect, ready = getDetector, onQueued = () => {} } = {}) {
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
      catch { reply(res, 503, { code: 'ANALYZER_UNAVAILABLE' }); }
      return;
    }
    if (req.method !== 'POST' || req.url !== '/v1/analyze') {
      reply(res, 404, { code: 'NOT_FOUND' }); return;
    }
    let fields;
    try {
      let size = 0;
      const chunks = [];
      for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) invalid();
        chunks.push(chunk);
      }
      if ((req.headers['content-type'] ?? '').split(';', 1)[0] !== 'application/json') invalid();
      fields = validate(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
    } catch {
      reply(res, 400, { code: 'INVALID_ANALYZE_REQUEST' }); return;
    }
    try {
      const findings = await queued(async () => {
        const values = new Set();
        for (const field of fields) {
          const allowed = new Set(field.allowedEntityTypes);
          const detected = detectedCategories(field.text, await infer(field.text));
          for (const category of detected) {
            if (!allowed.has(category)) values.add(JSON.stringify([field.fieldId, category]));
          }
        }
        return [...values].map(x => JSON.parse(x))
          .sort((a, b) => a[0].localeCompare(b[0], 'en') || a[1].localeCompare(b[1], 'en'))
          .map(([fieldId, entityType]) => ({ fieldId, entityType }));
      });
      reply(res, 200, {
        verdict: findings.length ? 'rejected' : 'accepted',
        modelPolicyVersion: MODEL_POLICY_VERSION, findings,
      });
    } catch { reply(res, 503, { code: 'ANALYZER_UNAVAILABLE' }); }
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
    console.error('ANALYZER_UNAVAILABLE');
    process.exitCode = 1;
  }
}
