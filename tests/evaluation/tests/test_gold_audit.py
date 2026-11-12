"""Independent, offline audit of frozen literals; never imports a detector."""
from collections import Counter
import json
from pathlib import Path
import re
import sys
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
import runner


def cf_valid(value):
    odd = dict(zip('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ',
        [1, 0, 5, 7, 9, 13, 15, 17, 19, 21, 1, 0, 5, 7, 9, 13, 15, 17, 19, 21,
         2, 4, 18, 20, 11, 3, 6, 8, 12, 14, 16, 10, 22, 25, 24, 23]))
    total = sum(odd[c] if i % 2 == 0 else int(c) if c.isdigit() else ord(c) - 65
                for i, c in enumerate(value[:-1]))
    return len(value) == 16 and value[-1] == chr(65 + total % 26)


def luhn_valid(value):
    digits = [int(c) for c in value if c.isdigit()][::-1]
    return sum((d * 2 // 10 + d * 2 % 10) if i % 2 else d for i, d in enumerate(digits)) % 10 == 0


def iban_valid(value):
    rotated = value[4:] + value[:4]
    expanded = ''.join(str(ord(c) - 55) if c.isalpha() else c for c in rotated)
    return int(expanded) % 97 == 1


def vat_valid(value):
    digits = [int(c) for c in value]
    total = sum(digits[::2]) + sum((d * 2 // 10 + d * 2 % 10) for d in digits[1::2])
    return len(value) == 11 and total % 10 == 0


class GoldAuditTests(unittest.TestCase):
    def setUp(self):
        self.gold = json.loads((ROOT / 'gold.json').read_text())
        self.cases = self.gold['cases'][:53]  # Original pilot is preserved, not relabelled.
        self.fields = [f for c in self.cases for f in c['fields']]

    def test_independent_inventory_and_unknowns(self):
        self.assertEqual(len(self.cases), 53)
        self.assertEqual(len(self.fields), 54)
        self.assertEqual(len({f['text'] for f in self.fields}), 54)
        self.assertEqual(Counter(c['source'] for c in self.cases), {'rizzo': 10, 'gretel': 18, 'targeted': 25})
        self.assertEqual(Counter(x for f in self.fields for x in f['expected']),
            {'PERSON': 28, 'EMAIL_ADDRESS': 12, 'PHONE_NUMBER': 10, 'CREDIT_CARD': 10,
             'IT_FISCAL_CODE': 8, 'IT_VAT_CODE': 2, 'IBAN_CODE': 4, 'IT_IDENTITY_CARD': 2, 'IT_DRIVER_LICENSE': 2})
        self.assertEqual(Counter(x for f in self.fields for x in f['unknown']),
                         {'IT_IDENTITY_CARD': 6, 'IT_DRIVER_LICENSE': 7})
        for c in self.cases:
            if c['source'] == 'rizzo' and 'ID_DOC' in c['provenance']['upstreamLabels']:
                self.assertEqual(c['fields'][0]['unknown'], ['IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'])
        self.assertEqual(max(len(f['text'].split()) for f in self.fields), 50)
        self.assertEqual(max(len(c['fields']) for c in self.cases), 2)
        self.assertTrue(all(1 <= len(c['fields']) <= 10 for c in self.cases))
        self.assertTrue(all(len(f['text'].split()) <= 50 for f in self.fields))
        # Independent policy oracle does not call expected_verdict().
        rejected = sum(any(any(category not in f['allowedCategories'] for category in f['expected'])
                           for f in c['fields']) for c in self.cases)
        self.assertEqual(rejected, 41)
        self.assertEqual(len(self.cases) - rejected, 12)

    def test_targeted_checksum_pairs_stay_positive_even_when_invalid(self):
        checks = [(3, 9, 'IT_FISCAL_CODE', r'\b[A-Z0-9]{16}\b', cf_valid),
                  (4, 10, 'IT_VAT_CODE', r'\b[0-9]{11}\b', vat_valid),
                  (5, 11, 'IBAN_CODE', r'\bIT[A-Z0-9]{25}\b', iban_valid),
                  (6, 12, 'CREDIT_CARD', r'\b[0-9]{16}\b', luhn_valid)]
        cases = {c['id']: c for c in self.cases}
        for good, bad, category, pattern, check in checks:
            for index, expected_validity in [(good, True), (bad, False)]:
                with self.subTest(index=index):
                    field = cases[f'targeted-{index:02}']['fields'][0]
                    values = re.findall(pattern, field['text'])
                    self.assertEqual(len(values), 1)
                    self.assertEqual(check(values[0]), expected_validity)
                    self.assertIn(category, field['expected'])
        # Selected Rizzo identifiers happen to pass checksums; no claim of external malformed coverage.
        for case in [c for c in self.cases if c['source'] == 'rizzo']:
            for span in case['provenance']['upstreamSpans']:
                if span['label'] == 'CF':
                    self.assertTrue(cf_valid(span['value']))
                if span['label'] == 'CREDITCARDNUMBER':
                    self.assertTrue(luhn_valid(span['value']))

    def test_manual_review_ledger_covers_every_merged_field(self):
        review = (ROOT / 'REVIEW.md').read_text()
        recorded = re.findall(r'\| `([^`]+)` \| `([^`]+)` \|', review)
        actual = [(c['id'], f['fieldId']) for c in self.gold['cases'] for f in c['fields']]
        self.assertEqual(Counter(recorded), Counter(actual))
        self.assertEqual(len(recorded), 92)

    def test_imported_checksum_failures_are_independently_confirmed(self):
        checks = [('it-fiscal-code-negative-02', 'IT_FISCAL_CODE', r'\b[A-Z0-9]{16}\b', cf_valid),
                  ('it-vat-code-negative-03', 'IT_VAT_CODE', r'\b[0-9]{11}\b', vat_valid),
                  ('iban-code-negative-02', 'IBAN_CODE', r'\bIT[A-Z0-9]{25}\b', iban_valid),
                  ('credit-card-negative-03', 'CREDIT_CARD', r'\b[0-9]{13}\b', luhn_valid)]
        cases = {c['id']: c for c in self.gold['cases']}
        for case_id, category, pattern, check in checks:
            f = cases['legacy-' + case_id]['fields'][0]
            values = re.findall(pattern, f['text'])
            self.assertEqual(len(values), 1)
            self.assertFalse(check(values[0]))
            self.assertEqual(f['expected'], [category])
        self.assertTrue(luhn_valid(cases['legacy-credit-card-isolated']['fields'][0]['text']))
        self.assertTrue(vat_valid('06495686690'))

    def test_exact_selected_source_ids_indices_and_scenarios(self):
        selected = {
            'it-fiscal-code-s01': 1, 'it-fiscal-code-s01-allow': 1,
            'it-driver-license-s01': 4, 'it-driver-license-s01-allow': 4,
            'phone-number-s01': 5, 'it-vat-code-s01': 6,
            'iban-code-s01': 7, 'iban-code-s01-wrong': 7,
            'it-fiscal-code-s02': 10, 'it-identity-card-s02': 12, 'it-identity-card-s02-all': 12,
            'iban-code-s02': 16, 'credit-card-s03': 26, 'phone-number-s04': 32,
            'email-address-s05': 38, 'person-s06': 45,
            'person-negative-01': 230, 'person-negative-02': 231, 'person-negative-03': 232,
            'email-address-negative-04': 239, 'it-fiscal-code-negative-02': 243,
            'it-identity-card-negative-03': 250, 'it-driver-license-negative-05': 258,
            'phone-number-negative-04': 263, 'it-vat-code-negative-03': 266,
            'iban-code-negative-02': 269, 'iban-code-negative-04': 271,
            'credit-card-negative-03': 274, 'credit-card-isolated': 282, 'it-driver-license-isolated': 284,
            'mixture-01': 285, 'mixture-01-partial': 285, 'mixture-01-full': 285,
            'phone-vat-overlap': 289, 'phone-vat-overlap-phone-only': 289,
            'phone-vat-overlap-vat-only': 289, 'phone-vat-overlap-all': 289, 'phone-vat-overlap-wrong': 289}
        imported = [c for c in self.gold['cases'] if c['source'] == 'legacy']
        self.assertEqual({c['provenance']['sourceCaseId']: c['provenance']['textIndex'] for c in imported}, selected)
        texts = {}
        for c in imported:
            i = c['provenance']['textIndex']
            f = c['fields'][0]
            if i in texts:
                self.assertEqual(texts[i], (f['text'], f['expected'], f['unknown']))
            texts[i] = (f['text'], f['expected'], f['unknown'])
        rejected = sum(any(set(f['expected']) - set(f['allowedCategories']) for f in c['fields']) for c in self.gold['cases'])
        self.assertEqual(rejected, 66)
        self.assertEqual(len(self.gold['cases']) - rejected, 25)


if __name__ == '__main__':
    unittest.main()
