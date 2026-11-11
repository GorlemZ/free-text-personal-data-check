// The sole live translation between semantic gold and each service's native wire labels.
import { TARGET_CATEGORIES } from '../catalog.mjs';
const fail = () => { throw new Error('INVALID_CATEGORY_MAP'); };
export const nativeToGold = Object.freeze({
  presidio: Object.freeze(Object.fromEntries(TARGET_CATEGORIES.map(c => [c, c]))),
  horizon: Object.freeze({ PERSON: 'PERSON', EMAIL: 'EMAIL_ADDRESS', PHONE: 'PHONE_NUMBER',
    PHONE_NUMBER: 'PHONE_NUMBER', IT_FISCAL_CODE: 'IT_FISCAL_CODE', IT_VAT_CODE: 'IT_VAT_CODE',
    IBAN_CODE: 'IBAN_CODE', CREDIT_CARD: 'CREDIT_CARD', NATIONAL_ID: 'IT_IDENTITY_CARD',
    DRIVER_LICENSE: 'IT_DRIVER_LICENSE' }),
});
const same = (a, b) => a.length === b.length && a.every(x => b.includes(x));
export function validateCategoryMap(map) {
  if (!map || typeof map !== 'object' || !same(Object.keys(map), ['presidio', 'horizon'])) fail();
  for (const engine of Object.keys(nativeToGold)) {
    const actual = map[engine], expected = nativeToGold[engine];
    if (!actual || typeof actual !== 'object' || Array.isArray(actual) ||
        !same(Object.keys(actual), Object.keys(expected)) ||
        Object.keys(expected).some(label => actual[label] !== expected[label]) ||
        !same([...new Set(Object.values(actual))], TARGET_CATEGORIES)) fail();
  }
  return map;
}
export function expandAllowlist(engine, semantic, map = nativeToGold) {
  if (!map?.[engine] || !Array.isArray(semantic) || new Set(semantic).size !== semantic.length ||
      semantic.some(c => !TARGET_CATEGORIES.includes(c))) fail();
  const expanded = Object.entries(map[engine]).filter(([, category]) => semantic.includes(category)).map(([label]) => label);
  if (new Set(expanded.map(label => map[engine][label])).size !== semantic.length) fail();
  return expanded;
}
export function projectFindings(engine, labels, map = nativeToGold) {
  if (!map?.[engine] || !Array.isArray(labels) || labels.some(label =>
    !Object.hasOwn(map[engine], label))) fail();
  return [...new Set(labels.map(label => map[engine][label]))];
}
