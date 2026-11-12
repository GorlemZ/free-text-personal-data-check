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
        self.cases = self.gold['cases']
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

    def test_external_texts_and_annotations_are_unmodified_parquet_rows(self):
        import pyarrow.parquet as pq
        for source in ('rizzo', 'gretel'):
            rows = pq.read_table(ROOT / '.downloads' / (source + '.parquet')).to_pylist()
            for case in [c for c in self.cases if c['source'] == source]:
                row = rows[case['provenance']['row']]
                text = row['source_text'] if source == 'rizzo' else row['generated_text']
                spans = row['entities'] if source == 'rizzo' else json.loads(row['pii_spans'])
                self.assertEqual(case['fields'][0]['text'].encode(), text.encode())
                self.assertEqual(case['provenance']['upstreamSpans'], spans)

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

    def test_readme_manual_review_ledger_covers_every_field(self):
        self.assertTrue((ROOT / 'README.md').exists(), 'Manual review ledger is missing')
        readme = (ROOT / 'README.md').read_text()
        recorded = re.findall(r'\| `(rizzo-\d+|gretel-\d+|targeted-\d+)` \| `([^`]+)` \|', readme)
        actual = [(c['id'], f['fieldId']) for c in self.cases for f in c['fields']]
        self.assertEqual(Counter(recorded), Counter(actual))
        self.assertEqual(len(recorded), 54)


if __name__ == '__main__':
    unittest.main()
