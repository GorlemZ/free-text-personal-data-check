import { FIELD_IDS } from './catalog.mjs';

const fields = new Set(FIELD_IDS);
const fail = () => { throw new Error('INVALID_RESPONSE'); };
const objectKeys = (value, keys) => value && !Array.isArray(value) &&
  typeof value === 'object' && Object.keys(value).sort().join() === keys.sort().join();

export function requestFor(sample, allowed = sample.allowedEntityTypes) {
  return { fields: [{ fieldId: sample.fieldId, text: sample.text,
    allowedEntityTypes: [...allowed] }] };
}

export function assertAnalyzeResponse(status, body, categories,
  { fieldId, allowedEntityTypes = [] } = {}) {
  if (status === 400 || status === 503) {
    if (!objectKeys(body, ['code']) ||
      body.code !== (status === 400 ? 'INVALID_ANALYZE_REQUEST' : 'ANALYZER_UNAVAILABLE')) fail();
    return body;
  }
  if (status !== 200 || !objectKeys(body, ['verdict', 'modelPolicyVersion', 'findings']) ||
    !['accepted', 'rejected'].includes(body.verdict) ||
    typeof body.modelPolicyVersion !== 'string' || !body.modelPolicyVersion ||
    !Array.isArray(body.findings) || !(categories instanceof Set)) fail();
  let previous = null;
  for (const finding of body.findings) {
    if (!objectKeys(finding, ['fieldId', 'entityType']) ||
      !fields.has(finding.fieldId) || !categories.has(finding.entityType) ||
      (fieldId !== undefined && finding.fieldId !== fieldId) ||
      allowedEntityTypes.includes(finding.entityType)) fail();
    const tuple = [finding.fieldId, finding.entityType];
    if (previous && (previous[0].localeCompare(tuple[0], 'en') > 0 ||
      (previous[0] === tuple[0] && previous[1].localeCompare(tuple[1], 'en') >= 0))) fail();
    previous = tuple;
  }
  if (body.verdict !== (body.findings.length ? 'rejected' : 'accepted')) fail();
  return body;
}
