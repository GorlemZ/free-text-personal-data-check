// Independent gold audit: no generator, detector, mapping, or service imports.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const corpusUrl = new URL('../corpus.json', import.meta.url);
const goldUrl = new URL('../gold.json', import.meta.url);
const texts = JSON.parse(await readFile(corpusUrl));
const annotations = JSON.parse(await readFile(goldUrl));
const rows = annotations.map(row => ({ ...row, text: texts[row.textIndex] }));
const manifest = JSON.parse(await readFile(new URL('../manifest.json', import.meta.url)));
const categories = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'];
const priority = ['PERSON', 'IT_FISCAL_CODE', 'EMAIL_ADDRESS', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'];
const uniqueTexts = new Map();
for (const row of rows) {
  if (!uniqueTexts.has(row.textIndex)) uniqueTexts.set(row.textIndex, []);
  uniqueTexts.get(row.textIndex).push(row);
}
const distinct = texts.map((_, i) => uniqueTexts.get(i)[0]);
const sort = values => [...values].sort();
const sameSet = (a, b) => assert.deepEqual(sort(a), sort(b));
const word = '[\\p{L}\\p{M}\\p{N}_]';
const whole = body => new RegExp(`(?<!${word})${body}(?!${word})`, 'giu');
const upperWhole = body => new RegExp(`(?<!${word})${body}(?!${word})`, 'gu');
const candidates = (text, expression, valid) => [...text.matchAll(expression)].some(match => valid(match[0]));

function fiscal(value) {
  // Canonical non-omocodia fiscal code; odd-position table differs from even-position ordinal weights.
  const s = value.toUpperCase();
  if (!/^[A-Z]{6}[0-9]{2}[ABCDEHLMPRST][0-9]{2}[A-Z][0-9]{3}[A-Z]$/.test(s)) return false;
  const odd = [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23];
  let total = 0;
  for (let i = 0; i < 15; i++) {
    const c = s[i]; const code = /[0-9]/.test(c) ? Number(c) : c.charCodeAt(0) - 65;
    total += i % 2 ? code : odd[code];
  }
  return s[15] === String.fromCharCode(65 + total % 26);
}
function vat(value) {
  const digits = value.replace(/^IT/, '');
  if (!/^[0-9]{11}$/.test(digits) || /^0+$/.test(digits)) return false;
  let total = 0;
  for (let i = 0; i < 11; i++) {
    let d = Number(digits[i]);
    if (i % 2) { d *= 2; if (d > 9) d -= 9; }
    total += d;
  }
  return total % 10 === 0;
}
function iban(value) {
  const s = value.replaceAll(' ', '').toUpperCase();
  if (!/^IT[0-9]{2}[A-Z][0-9]{10}[A-Z0-9]{12}$/.test(s)) return false;
  let remainder = 0;
  for (const c of s.slice(4) + s.slice(0, 4)) {
    const expanded = /[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c;
    for (const digit of expanded) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
function luhn(value) {
  const digits = value.replace(/[ -]/g, '');
  if (!/^[0-9]{13,19}$/.test(digits)) return false;
  let total = 0;
  for (let i = digits.length - 1, position = 0; i >= 0; i--, position++) {
    let digit = Number(digits[i]);
    if (position % 2) { digit *= 2; if (digit > 9) digit -= 9; }
    total += digit;
  }
  return total % 10 === 0;
}
const email = value => /^[A-Za-z0-9_+%-]+(?:\.[A-Za-z0-9_+%-]+)*@[A-Za-z0-9]+(?:[.-][A-Za-z0-9]+)*$/.test(value);
const structured = {
  IT_FISCAL_CODE: [whole('[A-Z]{6}[0-9]{2}[ABCDEHLMPRST][0-9]{2}[A-Z][0-9]{3}[A-Z]'), fiscal],
  IT_VAT_CODE: [whole('(?:IT)?[0-9]{11}'), vat],
  IBAN_CODE: [whole('IT(?:[ ]*[0-9]){2}[ ]*[A-Z](?:[ ]*[0-9]){10}(?:[ ]*[A-Z0-9]){12}'), iban],
  CREDIT_CARD: [whole('[0-9]+(?:[ -][0-9]+)*'), luhn],
  IT_IDENTITY_CARD: [upperWhole('[A-Z]{2}[0-9]{5}[A-Z]{2}'), () => true],
  // MIT circular 30039/24-10-2011: UCO duplicate series U1 + letter + six digits + control letter.
  // Final-letter calculation and actual assignment are unknown: morphology ONLY, not a checksum claim.
  IT_DRIVER_LICENSE: [upperWhole('U1[BCDEFGHJKLMNPRSTUVWXYZ][0-9]{6}[A-Z]'), () => true],
};
const has = (text, category) => candidates(text, ...structured[category]);

// These are gold-policy vectors, not examples from the detector implementations.
test('independent checksum and document morphology vectors', () => {
  assert.equal(fiscal('VRDDAA80A01H501A'), true);
  assert.equal(fiscal('VRDDAA80A01H501B'), false);
  assert.equal(vat('12345678903'), true);
  assert.equal(vat('00000000000'), false);
  assert.equal(iban('IT60X0542811101000000123456'), true);
  assert.equal(iban('IT61X0542811101000000123456'), false);
  assert.equal(luhn('4111 1111 1111 1111'), true);
  assert.equal(luhn('4111 1111 1111 1112'), false);
  assert.equal(has('CIE AB12345CD.', 'IT_IDENTITY_CARD'), true);
  assert.equal(has('CIE XAB12345CD7.', 'IT_IDENTITY_CARD'), false);
  assert.equal(has('CIE éAB12345CD.', 'IT_IDENTITY_CARD'), false);
  assert.equal(has('CIE ab12345cd.', 'IT_IDENTITY_CARD'), false);
  assert.equal(has('Patente U1B123456A.', 'IT_DRIVER_LICENSE'), true);
  assert.equal(has('Patente U1A123456A.', 'IT_DRIVER_LICENSE'), false);
  assert.equal(has('Patente U1B123456A9.', 'IT_DRIVER_LICENSE'), false);
});

test('nine-category coverage includes contextual and isolated positives and targeted negatives', () => {
  sameSet(manifest.categories, categories);
  for (const category of categories) {
    const focus = distinct.filter(r => r.focusCategory === category);
    assert.ok(focus.some(r => r.focusPolarity === 'positive' && r.scenario === 'isolated'), `${category}: isolated positive`);
    assert.ok(focus.some(r => r.focusPolarity === 'positive' && r.scenario !== 'isolated'), `${category}: contextual positive`);
    assert.ok(focus.some(r => r.focusPolarity === 'negative' && r.scenario !== 'excluded-category-distractor'), `${category}: targeted negative`);
  }
  assert.ok(distinct.length >= 250 && distinct.length <= 300, `distinct texts: ${distinct.length}`);
  const lengths = distinct.map(r => [...r.text].length).sort((a, b) => a - b);
  assert.ok(lengths[Math.floor(lengths.length / 2)] >= 100, 'natural median text length');
  const prioritized = distinct.filter(r => priority.includes(r.focusCategory)).length;
  assert.ok(prioritized / distinct.length >= 0.75 && prioritized / distinct.length <= 0.85, `priority mix: ${prioritized}/${distinct.length}`);
  for (const category of priority) {
    const families = new Set(distinct.filter(r => r.expectedEntities.includes(category)).map(r => r.familyId));
    assert.ok(families.size >= 25, `${category}: ${families.size} positive families`);
  }
});

test('structured categories include correct-shape, bad-checksum targeted negatives', () => {
  const nearMisses = {
    IT_FISCAL_CODE: [whole('[A-Z]{6}[0-9]{2}[ABCDEHLMPRST][0-9]{2}[A-Z][0-9]{3}[A-Z]'), fiscal],
    IT_VAT_CODE: [whole('(?:IT)?[0-9]{11}'), value => vat(value) || /^0+$/.test(value.replace(/^IT/, ''))],
    IBAN_CODE: [whole('IT(?:[ ]*[0-9]){2}[ ]*[A-Z](?:[ ]*[0-9]){10}(?:[ ]*[A-Z0-9]){12}'), iban],
    CREDIT_CARD: [whole('[0-9]+(?:[ -][0-9]+)*'), luhn],
  };
  for (const [category, [shape, passes]] of Object.entries(nearMisses)) {
    assert.ok(distinct.some(row => row.focusCategory === category && row.focusPolarity === 'negative' &&
      row.scenario === 'targeted-negative' && [...row.text.matchAll(shape)].some(m => !passes(m[0]))),
    `${category}: at least one full-shape checksum-negative candidate`);
  }
});

test('majority of priority positives does not reuse labelled-colon-value format', () => {
  const positives = distinct.filter(row => priority.includes(row.focusCategory) && row.focusPolarity === 'positive');
  const colon = positives.filter(row => /:\s+[^.!?]+[.!?]/u.test(row.text));
  assert.ok(colon.length / positives.length <= 0.4, `labelled colon format: ${colon.length}/${positives.length}`);
});

test('contextual texts do not predominantly narrate an editorial correction instead of using the datum', () => {
  const contextual = distinct.filter(row => row.scenario === 'positive');
  const editorial = contextual.filter(row => /\b(?:bozza|ricopiat[oaie]|copiat[oaie]|rimuov\w*|togli\w*|cancell\w*|non inoltrat\w*|non pubblicat\w*|promemoria del collaudo|testo da ripulire)\b/iu.test(row.text));
  assert.ok(editorial.length / contextual.length <= .15,
    `editorial-correction framing ${editorial.length}/${contextual.length}`);
});

test('fictional provenance belongs to metadata, not a repeated facsimile/test narrative in inputs', () => {
  const contextual = distinct.filter(row => row.scenario === 'positive');
  const meta = contextual.filter(row => /\b(?:simulazion\w*|facsimil\w*|dimostrativ\w*|fittizi\w*|esercitazion\w*|collaud\w*|di prova|di esempio|caso didattico)\b/iu.test(row.text));
  assert.ok(meta.length / contextual.length <= .05,
    `synthetic-meta framing ${meta.length}/${contextual.length}`);
});

test('local-seeded values are not attributed to Faker providers', () => {
  const local = ['PHONE_NUMBER','IT_VAT_CODE','IBAN_CODE','CREDIT_CARD','IT_DRIVER_LICENSE'];
  const provenance = new Map(manifest.provenance.map(p => [p.id, p]));
  for (const category of local) for (const row of distinct.filter(r => r.focusCategory === category && r.focusPolarity === 'positive')) {
    assert.equal(row.provenanceId, 'local-seeded', `${row.id}: local generation provenance`);
  }
  assert.equal(provenance.get('local-seeded')?.kind, 'local-seeded');
  assert.match(provenance.get('local-seeded')?.description ?? '', /seed/u);
});

test('priority contextual prose is not dominated by quoted field/value pairs', () => {
  for (const category of priority) {
    const contextual = distinct.filter(row => row.focusCategory === category && row.scenario === 'positive');
    const paired = contextual.filter(row => (row.text.match(/«/gu) ?? []).length >= 2);
    assert.ok(paired.length / contextual.length <= .4,
      `${category}: quoted field/value pair ${paired.length}/${contextual.length}`);
  }
});

test('no priority category repeats one fixed introductory phrase in every situation', () => {
  const fixed = {
    PERSON: 'la persona ',
    IT_FISCAL_CODE: 'il codice fiscale ',
    EMAIL_ADDRESS: 'la casella ',
    IT_IDENTITY_CARD: 'la carta elettronica CIE ',
    IT_DRIVER_LICENSE: 'il duplicato UCO della patente ',
  };
  for (const category of priority) {
    const contextual = distinct.filter(row => row.focusCategory === category && row.scenario === 'positive');
    const repeated = contextual.filter(row => row.text.includes(fixed[category]));
    assert.ok(repeated.length / contextual.length <= 0.4, `${category}: fixed intro ${repeated.length}/${contextual.length}`);
  }
});

test('Italian contextual prose avoids uncontracted prepositions, clear agreement slips and sentence lowercase', () => {
  const contextual = distinct.filter(row => row.scenario === 'positive');
  const bad = contextual.filter(row =>
    /\b(?:di|a|da|su|in) (?:la|il|lo|i|gli|le)\b/iu.test(row.text) ||
    /\b(?:la persona|la casella|la carta|le coordinate)\b[^.!?]*\b(?:fosse rimasto|era stato copiato)\b/iu.test(row.text) ||
    /[.!?]\s+[a-zà-ù]/u.test(row.text));
  assert.deepEqual(bad.map(row => row.id), [], `review contextual grammar across ${contextual.length} rows`);
});

test('mixed provenance is distinct and attributes Faker licensing accurately', () => {
  const sources = new Map(manifest.provenance.map(p => [p.id, p]));
  const mixed = sources.get('mixed-synthetic');
  assert.equal(mixed?.kind, 'mixed-synthetic');
  assert.match(sources.get('faker-synthetic')?.description ?? '', /MIT/u);
  for (const row of distinct.filter(r => r.id.startsWith('mixture-') ||
    r.id === 'it-fiscal-code-negative-02')) assert.equal(row.provenanceId, 'mixed-synthetic', row.id);
});

test('synthetic payment formats vary without implying issuer or bank validity', () => {
  const ibans = distinct.filter(row => row.expectedEntities.includes('IBAN_CODE'))
    .flatMap(row => [...row.text.matchAll(structured.IBAN_CODE[0])].map(m => m[0]).filter(iban));
  const cards = distinct.filter(row => row.expectedEntities.includes('CREDIT_CARD'))
    .flatMap(row => [...row.text.matchAll(structured.CREDIT_CARD[0])].map(m => m[0]).filter(luhn));
  assert.ok(new Set(ibans.map(value => value.replaceAll(' ', '')[4])).size >= 3,
    'IBAN domestic CIN must vary across at least three lexical values');
  assert.ok(new Set(cards.map(value => value[0])).size >= 2,
    'synthetic card prefixes must vary without asserting real issuance');
});

test('all structured positives and negatives are completely annotated across whole texts', () => {
  const errors = [];
  for (const row of distinct) for (const category of Object.keys(structured)) {
    const present = has(row.text, category);
    if (present !== row.expectedEntities.includes(category)) errors.push(`${row.id}:${category}:${present ? 'missing' : 'unexpected'}`);
  }
  assert.deepEqual(errors, [], 'syntactic/checksum-valid candidates, including non-focus overlaps');
});

test('ASCII email annotations are complete across whole texts, including overlaps', () => {
  const errors = [];
  for (const row of distinct) {
    // Consume malformed @@ envelopes whole rather than rescuing a valid-looking suffix.
    const envelopes = row.text.match(/[A-Za-z0-9._+%-]*@+[A-Za-z0-9.-]*/g) || [];
    const present = envelopes.some(value => email(value.replace(/\.$/, '')));
    if (present !== row.expectedEntities.includes('EMAIL_ADDRESS')) errors.push(row.id);
  }
  assert.deepEqual(errors, []);
});

test('focus, duplicate policy texts and deny-by-default verdicts use complete gold', () => {
  for (const [index, group] of uniqueTexts) {
    const text = texts[index];
    const first = group[0];
    for (const row of group) {
      assert.equal(new Set(row.expectedEntities).size, row.expectedEntities.length, `${row.id}: duplicate expected category`);
      assert.equal(new Set(row.allowedEntityTypes).size, row.allowedEntityTypes.length, `${row.id}: duplicate allowlist category`);
      assert.equal(row.focusPolarity, row.expectedEntities.includes(row.focusCategory) ? 'positive' : 'negative', row.id);
      sameSet(row.expectedEntities, first.expectedEntities);
      assert.equal(row.familyId, first.familyId, `${row.id}: policy variants must share a family`);
      assert.equal(row.split, 'evaluation', row.id);
      assert.equal(row.expectedVerdict, row.expectedEntities.some(c => !row.allowedEntityTypes.includes(c)) ? 'rejected' : 'accepted', row.id);
      assert.ok(row.expectedEntities.every(c => categories.includes(c)), row.id);
      assert.ok(row.allowedEntityTypes.every(c => categories.includes(c)), row.id);
    }
    assert.ok(text.length > 0);
  }
  assert.ok(rows.some(r => r.expectedEntities.length > 1 && r.expectedVerdict === 'accepted'), 'accepted multi-category case');
  assert.ok(rows.some(r => r.expectedEntities.length > 1 && r.allowedEntityTypes.length && r.expectedVerdict === 'rejected'), 'partial allowlist');
  for (const category of categories) {
    assert.ok(rows.some(r => r.focusCategory === category && r.focusPolarity === 'positive' && r.allowedEntityTypes.length && r.allowedEntityTypes.every(c => !r.expectedEntities.includes(c)) && r.expectedVerdict === 'rejected'), `${category}: wrong allowlist`);
  }
});

test('one numeric phone/VAT overlap rejects either partial exception', () => {
  const overlaps = [...uniqueTexts.values()].filter(group => {
    const row = group[0];
    return row.expectedEntities.includes('PHONE_NUMBER') && row.expectedEntities.includes('IT_VAT_CODE')
      && candidates(row.text, structured.IT_VAT_CODE[0], vat);
  });
  assert.ok(overlaps.length, 'independently valid numeric phone/VAT overlap');
  assert.ok(overlaps.some(group => {
    const variants = group.map(r => ({ allowed: r.allowedEntityTypes, verdict: r.expectedVerdict }));
    return variants.some(v => v.allowed.includes('PHONE_NUMBER') && !v.allowed.includes('IT_VAT_CODE') && v.verdict === 'rejected')
      && variants.some(v => v.allowed.includes('IT_VAT_CODE') && !v.allowed.includes('PHONE_NUMBER') && v.verdict === 'rejected')
      && variants.some(v => v.allowed.includes('PHONE_NUMBER') && v.allowed.includes('IT_VAT_CODE') && v.verdict === 'accepted');
  }), 'both partial and complete allowlist variants of one overlap');
});

test('policy variants do not inflate text diversity or disguise dominant families', () => {
  assert.equal(manifest.counts.samples, rows.length);
  assert.equal(manifest.counts.detectionSamples, distinct.length);
  assert.equal(manifest.counts.policyVariants, rows.length - distinct.length);
  const byFamily = new Map();
  for (const [index, group] of uniqueTexts) {
    const text = texts[index];
    const family = group[0].familyId;
    if (!byFamily.has(family)) byFamily.set(family, { texts: new Set(), rows: 0 });
    byFamily.get(family).texts.add(text);
    byFamily.get(family).rows += group.length;
  }
  assert.equal(manifest.counts.families, byFamily.size);
  const largestTexts = Math.max(...[...byFamily.values()].map(x => x.texts.size));
  const largestRows = Math.max(...[...byFamily.values()].map(x => x.rows));
  assert.ok(largestTexts / distinct.length <= 0.2, `largest family texts ${largestTexts}/${distinct.length}`);
  assert.ok(largestRows / rows.length <= 0.25, `largest family policy rows ${largestRows}/${rows.length}`);
  assert.ok(manifest.limitations.some(s => /famil/i.test(s) && /correlat/i.test(s)), 'disclose family correlation');
});

test('reused structured values and formatting variants share their underlying family', () => {
  const familiesByValue = new Map();
  for (const row of distinct) for (const [category, [expression, valid]] of Object.entries(structured)) {
    for (const match of row.text.matchAll(expression)) {
      if (!valid(match[0])) continue;
      const key = `${category}:${match[0].toUpperCase().replace(/[ -]/g, '')}`;
      if (!familiesByValue.has(key)) familiesByValue.set(key, new Set());
      familiesByValue.get(key).add(row.familyId);
    }
  }
  const mismatches = [...familiesByValue].filter(([, families]) => families.size > 1)
    .map(([key, families]) => `${key.split(':')[0]}:${[...families].join(',')}`);
  assert.deepEqual(mismatches, [], 'one reused identifier must not count as independent families');
});

test('whole-envelope phone annotations follow pinned independent metadata', async () => {
  const pyproject = await readFile(new URL('../../poc-spacy/pyproject.toml', import.meta.url), 'utf8');
  const version = pyproject.match(/phonenumbers==([0-9.]+)/)?.[1];
  assert.ok(version, 'pinned phonenumbers dependency');
  const python = fileURLToPath(new URL('../../poc-spacy/.venv/bin/python', import.meta.url));
  const script = `import json,sys,re,unicodedata,phonenumbers
assert phonenumbers.__version__ == sys.argv[2], 'gold metadata must match pinned dependency'
rows=json.load(open(sys.argv[1],encoding='utf-8'))
texts=json.load(open(sys.argv[3],encoding='utf-8'))
def word(c): return c.isalnum() or c=='_' or unicodedata.category(c).startswith('M')
errors=[]
for r in rows:
 text=texts[r['textIndex']]
 valid=False
 # Match complete numeric envelopes, never salvage an inner metadata-valid substring.
 for m in re.finditer(r'(?:\\+|00)?[0-9][0-9 ()-]*[0-9]',text):
  if m.start() and (word(text[m.start()-1]) or text[m.start()-1]=='+'): continue
  if m.end()<len(text) and (word(text[m.end()]) or text[m.end()]=='+'): continue
  try: valid=valid or phonenumbers.is_valid_number(phonenumbers.parse(m[0],'IT'))
  except phonenumbers.NumberParseException: pass
 if valid != ('PHONE_NUMBER' in r['expectedEntities']): errors.append(r['id'])
print(json.dumps(dict(checked=len(rows),version=phonenumbers.__version__,errors=errors)))`;
  const out = execFileSync(python, ['-c', script, fileURLToPath(goldUrl), version,
    fileURLToPath(corpusUrl)], { encoding: 'utf8' });
  const result = JSON.parse(out);
  assert.equal(result.checked, rows.length);
  assert.deepEqual(result.errors, []);
  assert.ok(manifest.provenance.some(p => p.description.includes(`phonenumbers ${result.version}`)));
});
