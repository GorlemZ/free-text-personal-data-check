export function decodeBIO(ids, logits, id2label, tokenizer) {
  const [batch, sequence, classes] = logits.dims;
  if (batch !== 1 || sequence !== ids.length || classes !== Object.keys(id2label).length || logits.data.length !== sequence * classes) throw new Error('INVALID_MODEL_OUTPUT');
  const specials = new Set(tokenizer.all_special_ids);
  const entities = [];
  let current = null;
  const flush = () => {
    if (current) entities.push({label: current.label, text: tokenizer.decode(current.ids, {skip_special_tokens: true}).trim(), score: current.sum / current.ids.length});
    current = null;
  };
  for (let i = 0; i < sequence; i++) {
    let winner = 0, best = -Infinity;
    for (let j = 0; j < classes; j++) {
      const value = logits.data[i * classes + j];
      if (!Number.isFinite(value)) throw new Error('INVALID_MODEL_OUTPUT');
      if (value > best) { best = value; winner = j; }
    }
    const tag = id2label[winner];
    if (typeof tag !== 'string' || (tag !== 'O' && !/^[BI]-[A-Z_]+$/.test(tag))) throw new Error('INVALID_MODEL_LABEL');
    if (specials.has(Number(ids[i])) || tag === 'O') { flush(); continue; }
    const label = tag.slice(2);
    let denominator = 0;
    for (let j = 0; j < classes; j++) denominator += Math.exp(logits.data[i * classes + j] - best);
    if (!current || current.label !== label || tag.startsWith('B-')) { flush(); current = {label, ids: [], sum: 0}; }
    current.ids.push(Number(ids[i])); current.sum += 1 / denominator;
  }
  flush();
  return entities;
}
const MODEL_MAP = Object.freeze({ FULLNAME: 'PERSON', EMAIL: 'EMAIL_ADDRESS', CF: 'IT_FISCAL_CODE', PIVA: 'IT_VAT_CODE', IBAN: 'IBAN_CODE', CREDITCARDNUMBER: 'CREDIT_CARD' });
export function semanticCategories(entities) {
  const categories = new Set();
  for (const entity of entities) {
    if (!Number.isFinite(entity.score) || entity.score < 0.5 || !entity.text) continue;
    if (MODEL_MAP[entity.label]) categories.add(MODEL_MAP[entity.label]);
    if (entity.label === 'TELEPHONENUM') {
      // Only national forms; do not reinterpret an explicit foreign prefix.
      const value = entity.text.replace(/[\s().-]/gu, '');
      const national = value.startsWith('+39') ? value.slice(3) : value.startsWith('0039') ? value.slice(4) : value;
      if (/^(?:3\d{8,9}|0[1-9]\d{4,9})$/.test(national)) categories.add('PHONE_NUMBER');
    }
    // ID_DOC conflates passport/identity/license. Only the explicit local rules distinguish these.
  }
  return categories;
}
