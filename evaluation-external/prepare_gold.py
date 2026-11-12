"""Offline deterministic selection; never truncates or calls a detector.

Run: uv run --with pyarrow==23.0.1 python evaluation-external/prepare_gold.py
The two downloaded parquet files are prerequisites, not downloaded here.
"""
import argparse
import hashlib
import json
from pathlib import Path
import pyarrow.parquet as pq
from runner import CATALOG

ROOT = Path(__file__).resolve().parent
REVISIONS = {'rizzo': '50163bcda973efe818004d053cfa159f0927663f',
             'gretel': '7b844d16738527a04264f50214cb426a4cea0897'}
# Fixed original row ordinals, selected and read in full before any inference.
ROWS = {'rizzo': [2266, 2335, 14989, 15085, 15127, 15224, 15261, 15265, 15285, 26377],
        'gretel': [38, 50, 60, 96, 114, 128, 146, 256, 282, 311, 313, 321, 328, 364, 382, 421, 431, 443]}
MAPPING = {'rizzo': {'FULLNAME': 'PERSON', 'GIVENNAME': 'PERSON', 'SURNAME': 'PERSON',
                     'EMAIL': 'EMAIL_ADDRESS', 'TELEPHONENUM': 'PHONE_NUMBER',
                     'CF': 'IT_FISCAL_CODE', 'PIVA': 'IT_VAT_CODE', 'IBAN': 'IBAN_CODE',
                     'CREDITCARDNUMBER': 'CREDIT_CARD', 'IDCARDNUM': 'IT_IDENTITY_CARD',
                     'DRIVERLICENSENUM': 'IT_DRIVER_LICENSE'},
           'gretel': {'name': 'PERSON', 'first_name': 'PERSON', 'last_name': 'PERSON',
                      'email': 'EMAIL_ADDRESS', 'iban': 'IBAN_CODE', 'credit_card_number': 'CREDIT_CARD'}}
# Explicit complete-text review: these are not inferred from absent upstream labels.
REVIEWED_POSITIVES = {
 'rizzo': {
  2266: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE'],
  2335: ['PERSON'],
  14989: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'CREDIT_CARD'],
  15085: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'CREDIT_CARD'],
  15127: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'CREDIT_CARD'],
  15224: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'CREDIT_CARD'],
  15261: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'CREDIT_CARD'],
  15265: ['PERSON', 'PHONE_NUMBER', 'IT_FISCAL_CODE'],
  15285: ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE', 'CREDIT_CARD'],
  26377: ['PERSON']},
 'gretel': {38: ['PERSON', 'CREDIT_CARD'], 50: ['PERSON'], 60: [], 96: ['PERSON'],
  114: [], 128: [], 146: ['PERSON', 'EMAIL_ADDRESS'], 256: ['PERSON'], 282: ['PERSON'],
  311: [], 313: [], 321: ['PERSON'], 328: ['PERSON', 'IBAN_CODE'], 364: ['PERSON'],
  382: ['PERSON'], 421: ['PERSON'], 431: ['PERSON'], 443: ['PERSON']}}
TARGET_CATEGORIES = [
 ['PERSON'], ['EMAIL_ADDRESS'], ['PHONE_NUMBER'], ['IT_FISCAL_CODE'], ['IT_VAT_CODE'],
 ['IBAN_CODE'], ['CREDIT_CARD'], ['IT_IDENTITY_CARD'], ['IT_DRIVER_LICENSE'],
 ['IT_FISCAL_CODE'], ['IT_VAT_CODE'], ['IBAN_CODE'], ['CREDIT_CARD'],
 [], [], [], [], [], ['PERSON'], ['EMAIL_ADDRESS'], ['PERSON', 'EMAIL_ADDRESS'],
 ['PERSON', 'EMAIL_ADDRESS'], ['IBAN_CODE'], ['CREDIT_CARD'], ['PERSON'], ['PHONE_NUMBER']]
TARGET_ALLOWED = {18: ['PERSON'], 19: ['PERSON'], 20: ['PERSON'], 21: CATALOG, 24: ['PERSON']}


def build_gold():
    cases, files = [], {}
    for source, indexes in ROWS.items():
        path = ROOT / '.downloads' / (source + '.parquet')
        files[source] = {'revision': REVISIONS[source], 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()}
        rows = pq.read_table(path).to_pylist()
        files[source]['rows'] = len(rows)
        for index in indexes:
            row = rows[index]
            text = row['source_text'] if source == 'rizzo' else row['generated_text']
            spans = row['entities'] if source == 'rizzo' else json.loads(row['pii_spans'])
            labels = sorted({s['label'] for s in spans})
            unknown = []
            if 'ID_DOC' in labels:
                unknown = ['IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']
            if source == 'gretel' and index == 96:
                unknown = ['IT_DRIVER_LICENSE']
            positives = REVIEWED_POSITIVES[source][index]
            assert set(positives).isdisjoint(unknown)
            assert len(text.split()) <= 50
            assert len(text) <= 2000 and len(text.encode()) <= 8000
            review_note = 'Full text read; all nine presence labels explicitly reviewed. Out-of-catalog entities ignored.'
            if source == 'rizzo':
                review_note += ' Masked phone remains recognizable; ID_DOC is not a national document subtype.'
            if source == 'gretel':
                review_note += ' Italian_test includes structured/foreign-name text; span completeness is not assumed.'
            cases.append({'id': f'{source}-{index}', 'source': source,
                          'provenance': {'revision': REVISIONS[source], 'row': index,
                                         'split': 'clean/val' if source == 'rizzo' else 'Italian_test',
                                         'originalIndex': row.get('__index_level_0__'),
                                         'upstreamLabels': labels, 'upstreamSpans': spans},
                          'family': ('rizzo-thread' if source == 'rizzo' and index >= 14989 and index < 26000
                                     else 'rizzo-legal' if source == 'rizzo'
                                     else 'gretel-' + row['document_type']),
                          'review': {'completeTextRead': True, 'reviewer': 'implementation-agent',
                                     'independentReview': False, 'note': review_note},
                          'fields': [{'fieldId': 'description', 'text': text,
                                      'expected': positives, 'unknown': unknown, 'allowedCategories': []}]})
    texts = json.loads((ROOT / 'targeted-texts.json').read_text())
    assert len(texts) == len(TARGET_CATEGORIES) == 26
    for index, text in enumerate(texts):
        field = {'fieldId': 'description', 'text': text, 'expected': TARGET_CATEGORIES[index],
                 'unknown': [], 'allowedCategories': TARGET_ALLOWED.get(index, [])}
        if index == 25:
            field['fieldId'] = 'eserviceDescription'
            cases[-1]['fields'].append(field)
            continue
        if index == 24:
            field['fieldId'] = 'contactName'
        cases.append({'id': f'targeted-{index:02}', 'source': 'targeted',
                      'family': ('checksum-' + TARGET_CATEGORIES[index][0] if index in (3, 4, 5, 6, 9, 10, 11, 12)
                                 else f'authored-{index:02}'),
                      'provenance': {'kind': 'literal-synthetic-authored', 'textIndex': index},
                      'review': {'completeTextRead': True, 'reviewer': 'implementation-agent',
                                 'independentReview': False}, 'fields': [field]})
    return {'schemaVersion': 1, 'goldVersion': 'external-pilot-1',
            'frozenBeforeInference': True, 'catalog': CATALOG, 'sourceFiles': files,
            'mapping': MAPPING, 'cases': cases}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true', help='Compare without writing')
    args = parser.parse_args()
    gold = build_gold()
    serialized = json.dumps(gold, ensure_ascii=False, indent=2) + '\n'
    path = ROOT / 'gold.json'
    if args.check:
        if path.read_text() != serialized:
            raise SystemExit('GOLD_DIFFERS')
        print('Frozen gold matches offline preparation.')
    else:
        path.write_text(serialized)
        print(json.dumps({'cases': len(gold['cases']),
                          'texts': sum(len(c['fields']) for c in gold['cases']),
                          'external': sum(c['source'] != 'targeted' for c in gold['cases'])}))


if __name__ == '__main__':
    main()
