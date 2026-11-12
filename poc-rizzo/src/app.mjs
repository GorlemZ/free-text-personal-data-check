import http from 'node:http';
import { CATEGORIES } from './categories.mjs';

const knownCategories = new Set(CATEGORIES);
const objectWithKeys = (value, keys) => value !== null && typeof value === 'object'
  && !Array.isArray(value) && Object.keys(value).every(key => keys.includes(key));
function validPayload(payload) {
  if (!objectWithKeys(payload, ['fields']) || !Array.isArray(payload.fields)
    || payload.fields.length < 1 || payload.fields.length > 10) return false;
  const ids = new Set();
  for (const field of payload.fields) {
    if (!objectWithKeys(field, ['fieldId', 'text', 'allowedCategories'])
      || typeof field.fieldId !== 'string' || field.fieldId.length === 0 || field.fieldId.length > 128
      || !field.fieldId.isWellFormed() || ids.has(field.fieldId) || typeof field.text !== 'string' || !field.text.isWellFormed()
      || field.text.split(/\p{White_Space}+/u).filter(Boolean).length > 50) return false;
    if (Object.hasOwn(field, 'allowedCategories') && (!Array.isArray(field.allowedCategories)
      || !field.allowedCategories.every(category => knownCategories.has(category)))) return false;
    ids.add(field.fieldId);
  }
  return true;
}

// JSON.parse validates syntax; a separate iterative token walk preserves keys
// before JSON.parse's last-value-wins semantics can hide duplicates.
function parseUniqueJSON(source) {
  const payload = JSON.parse(source);
  const stack = [];
  const tokens = /"(?:\\[\s\S]|[^"\\])*"|[{}\[\]:,]/g;
  for (const match of source.matchAll(tokens)) {
    const token = match[0];
    if (token === '{') stack.push(new Set());
    else if (token === '[') stack.push(null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && /^[\x20\t\r\n]*:/.test(source.slice(match.index + token.length))) {
      const key = JSON.parse(token);
      const keys = stack.at(-1);
      if (keys.has(key)) throw new Error('duplicate_key');
      keys.add(key);
    }
  }
  return payload;
}

export function createServer({ detect, ready = () => true }) {
  return http.createServer(async (request, response) => {
    const send = (status, body) => {
      response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' });
      response.end(JSON.stringify(body));
    };
    if (request.method === 'GET' && request.url === '/health/ready') {
      try { if (await ready()) return send(200, { status: 'ready' }); } catch {}
      return send(503, { code: 'detector_unavailable' });
    }
    if (request.method !== 'POST' || request.url !== '/v1/analyze') return send(404, { code: 'not_found' });
    if ((request.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase() !== 'application/json') { request.resume(); return send(400, {code: 'invalid_request'}); }
    const chunks = [];
    let size = 0;
    let payload;
    try {
      for await (const chunk of request.iterator({ destroyOnReturn: false })) {
        size += chunk.length;
        if (size > 1024 * 1024) {
          request.resume();
          response.setHeader('connection', 'close');
          return send(413, { code: 'body_too_large' });
        }
        chunks.push(chunk);
      }
      payload = parseUniqueJSON(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(Buffer.concat(chunks)));
    } catch { return send(400, { code: 'invalid_request' }); }
    if (!validPayload(payload)) return send(400, { code: 'invalid_request' });
    const findings = [];
    try {
      if (!await ready()) throw new Error('detector_unavailable');
      for (const field of payload.fields) {
        const allowed = new Set(field.allowedCategories ?? []);
        const categories = await detect(field.text);
        if (!(categories instanceof Set)) throw new Error('invalid_detector_result');
        for (const category of categories) {
          if (!knownCategories.has(category)) throw new Error('invalid_detector_category');
          if (!allowed.has(category)) findings.push({ fieldId: field.fieldId, category });
        }
      }
    } catch { return send(503, { code: 'detector_unavailable' }); }
    const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
    findings.sort((a, b) => compare(a.fieldId, b.fieldId) || compare(a.category, b.category));
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ verdict: findings.length ? 'rejected' : 'accepted', findings }));
  });
}
