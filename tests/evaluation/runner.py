"""Uniform three-engine presence/policy pilot; standard library, no inference imports."""
import argparse
import csv
import http.client
import json
import re
import sys
from pathlib import Path
import urllib.request
import urllib.error

CATALOG = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE',
           'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']
ENGINES = ['rizzo', 'horizon', 'presidio']
SOURCES = ['rizzo', 'gretel', 'targeted', 'legacy']
PROVENANCE_KEYS = {'revision', 'row', 'split', 'originalIndex', 'index', 'sourceCaseId',
                   'textIndex', 'familyId', 'scenario', 'provenanceId'}
STATUSES = ('success', 'technical_failure', 'contract_failure', 'unattempted')
WHITE_SPACE = re.compile(r'[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]+')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def valid_string(value):
    return isinstance(value, str) and not any(0xD800 <= ord(c) <= 0xDFFF for c in value)


def words(text):
    return len([s for s in WHITE_SPACE.split(text) if s])


def labels(value, allowed=CATALOG):
    require(isinstance(value, list) and all(isinstance(x, str) and x for x in value), 'LABELS')
    require(len(value) == len(set(value)), 'DUPLICATE_LABEL')
    require(set(value) <= set(allowed), 'UNKNOWN_LABEL')


def validate_cases(cases, with_text=True):
    require(isinstance(cases, list) and bool(cases), 'CASES')
    ids = set()
    literals = {}
    for case in cases:
        required = {'id', 'source', 'family', 'provenance', 'fields'} | ({'review'} if with_text else set())
        require(isinstance(case, dict) and set(case) == required, 'CASE_SCHEMA')
        require(valid_string(case['id']) and case['id'] and case['id'] not in ids, 'CASE_ID')
        ids.add(case['id'])
        require(case['source'] in SOURCES and valid_string(case['family']) and case['family'], 'SOURCE')
        require(isinstance(case['provenance'], dict), 'PROVENANCE')
        if not with_text:
            require(set(case['provenance']) <= PROVENANCE_KEYS and
                    all(v is None or type(v) is int or valid_string(v) for v in case['provenance'].values()), 'PROVENANCE')
        else:
            require(isinstance(case['review'], dict) and case['review'].get('completeTextRead') is True, 'REVIEW')
        if case['source'] == 'legacy':
            provenance = case['provenance']
            require({'revision', 'sourceCaseId', 'textIndex', 'familyId', 'scenario', 'split', 'provenanceId'} <= set(provenance), 'LEGACY_PROVENANCE')
            require(provenance['revision'] == '38360c8d7f776c075457e319bd957502a03c963b' and
                    type(provenance['textIndex']) is int and 0 <= provenance['textIndex'] < 290 and
                    valid_string(provenance['sourceCaseId']) and case['id'] == 'legacy-' + provenance['sourceCaseId'] and
                    valid_string(provenance['familyId']) and case['family'] == 'legacy-' + provenance['familyId'], 'LEGACY_PROVENANCE')
            if with_text:
                require(valid_string(provenance.get('selectionRationale')) and bool(provenance['selectionRationale']), 'LEGACY_RATIONALE')
        fields = case['fields']
        require(isinstance(fields, list) and 1 <= len(fields) <= 10, 'FIELD_LIMIT')
        field_ids = set()
        for field in fields:
            required = {'fieldId', 'expected', 'unknown', 'allowedCategories', 'text' if with_text else 'textId'}
            require(isinstance(field, dict) and set(field) == required, 'FIELD_SCHEMA')
            fid = field['fieldId']
            require(valid_string(fid) and 1 <= len(fid.encode('utf-16-be')) // 2 <= 128 and fid not in field_ids, 'FIELD_ID')
            field_ids.add(fid)
            for key in ('expected', 'unknown', 'allowedCategories'):
                labels(field[key])
            require(set(field['expected']).isdisjoint(field['unknown']), 'CONTRADICTORY_GOLD')
            if with_text:
                require(valid_string(field['text']) and words(field['text']) <= 50, 'TEXT_LIMIT')
            else:
                require(isinstance(field['textId'], str) and re.fullmatch(r'text-[0-9]+', field['textId']), 'TEXT_ID')
            text_key = field['text' if with_text else 'textId']
            annotation = (case['source'], case['family'], set(field['expected']), set(field['unknown']))
            require(text_key not in literals or literals[text_key] == annotation, 'DUPLICATE_TEXT_GOLD')
            literals[text_key] = annotation
        if with_text:
            require(len(json.dumps(payload_for(case, 'policy'), ensure_ascii=False).encode('utf-8')) <= 1048576, 'BODY_LIMIT')


def validate_gold(gold):
    require(isinstance(gold, dict) and gold.get('schemaVersion') == 2 and gold.get('catalog') == CATALOG
            and gold.get('annotationsBeforeNewRun') is True and gold.get('heldout') is False, 'GOLD_SCHEMA')
    validate_cases(gold.get('cases'))
    if any(c['source'] == 'legacy' for c in gold['cases']):
        counts = gold_counts(gold)
        review = gold.get('mergedReview', {})
        require(review.get('distinctTextsRead') == counts['distinctTexts'] and
                review.get('casesReviewed') == counts['cases'] and
                review.get('fieldCategoryDecisions') == counts['fields'] * len(CATALOG), 'REVIEW_COUNTS')
        source = gold.get('sourceFiles', {}).get('legacy', {})
        require(source.get('selectedCases') == counts['sources']['legacy']['cases'] and
                source.get('selectedDistinctTexts') == counts['sources']['legacy']['distinctTexts'], 'SOURCE_COUNTS')


def expected_verdict(case):
    if any(set(f['expected']) - set(f['allowedCategories']) for f in case['fields']):
        return 'rejected'
    if any(set(f['unknown']) - set(f['allowedCategories']) for f in case['fields']):
        return None
    return 'accepted'


def payload_for(case, probe):
    require(probe in ('detection', 'policy'), 'PROBE')
    return {'fields': [{'fieldId': f['fieldId'], 'text': f['text'],
            'allowedCategories': f['allowedCategories'] if probe == 'policy' else []} for f in case['fields']]}


def project_response(body, case, probe='detection'):
    require(isinstance(body, dict) and set(body) == {'verdict', 'findings'}, 'RESPONSE_SCHEMA')
    require(body['verdict'] in ('accepted', 'rejected') and isinstance(body['findings'], list), 'RESPONSE_SCHEMA')
    fields = {f['fieldId']: f for f in case['fields']}
    for item in body['findings']:
        require(isinstance(item, dict) and set(item) == {'fieldId', 'category'}, 'FINDING_SCHEMA')
        require(isinstance(item['fieldId'], str) and item['fieldId'] in fields and isinstance(item['category'], str), 'FINDING_SCHEMA')
        require(item['category'] in CATALOG, 'UNKNOWN_CATEGORY')
        require(probe != 'policy' or item['category'] not in fields[item['fieldId']]['allowedCategories'], 'ALLOWED_FINDING')
    pairs = [(f['fieldId'], f['category']) for f in body['findings']]
    require(len(pairs) == len(set(pairs)), 'DUPLICATE_FINDING')
    require(pairs == sorted(pairs, key=lambda p: (p[0].encode('utf-16-be'), p[1].encode('utf-16-be'))), 'FINDING_ORDER')
    require((body['verdict'] == 'rejected') == bool(body['findings']), 'INCONSISTENT_VERDICT')
    # Retain the validated wire object; never deduplicate, sort or soften it.
    return {'response': body}


def project_cases(cases):
    texts, projected = {}, []
    for case in cases:
        fields = []
        for field in case['fields']:
            tid = texts.setdefault(field['text'], 'text-' + str(len(texts)))
            fields.append({**{k: field[k] for k in ('fieldId', 'expected', 'unknown', 'allowedCategories')}, 'textId': tid})
        projected.append({**{k: case[k] for k in ('id', 'source', 'family')},
                          'provenance': {k: v for k, v in case['provenance'].items() if k in PROVENANCE_KEYS}, 'fields': fields})
    return projected


def inventory(cases):
    def count(selected):
        fields = [f for c in selected for f in c['fields']]
        return {'cases': len(selected), 'fields': len(fields), 'distinctTexts': len({f['textId'] for f in fields}),
                'families': len({c['family'] for c in selected}), 'unknownPairs': sum(len(f['unknown']) for f in fields)}
    return {source: count([c for c in cases if source == 'ALL' or c['source'] == source])
            for source in sorted({c['source'] for c in cases}) + ['ALL']}


def validate_result(result):
    require(isinstance(result, dict) and set(result) == {'schemaVersion', 'catalog', 'engines', 'heldout',
            'cases', 'inventory', 'observations', 'metrics', 'complete'}, 'RESULT_SCHEMA')
    require(result['schemaVersion'] == 2 and result['catalog'] == CATALOG and result['heldout'] is False, 'RESULT_VERSION')
    require(result['engines'] == ENGINES, 'ENGINES')
    validate_cases(result['cases'], with_text=False)
    require(result['inventory'] == inventory(result['cases']), 'INVENTORY_MISMATCH')
    cases = {c['id']: c for c in result['cases']}
    wanted = {(e, p, c) for e in ENGINES for p in ('detection', 'policy') for c in cases}
    seen = set()
    require(isinstance(result['observations'], list), 'OBSERVATIONS')
    for observation in result['observations']:
        base = {'caseId', 'engine', 'probe', 'status'}
        require(isinstance(observation, dict) and base <= set(observation), 'OBSERVATION_SCHEMA')
        key = (observation['engine'], observation['probe'], observation['caseId'])
        require(all(isinstance(x, str) for x in key) and key in wanted and key not in seen, 'OBSERVATION_ID')
        seen.add(key)
        if observation['status'] == 'success':
            require(set(observation) == base | {'response'}, 'OBSERVATION_SCHEMA')
            project_response(observation['response'], cases[key[2]], key[1])
        else:
            require(observation['status'] in STATUSES[1:] and set(observation) == base | {'errorCode'}, 'OBSERVATION_SCHEMA')
            code = observation['errorCode']
            safe = {'TRANSPORT_ERROR', 'INTERRUPTED', 'NOT_ATTEMPTED', 'INVALID_JSON', 'DUPLICATE_JSON_KEY',
                    'RESPONSE_TOO_LARGE', 'RESPONSE_SCHEMA', 'FINDING_SCHEMA', 'UNKNOWN_CATEGORY',
                    'INCONSISTENT_VERDICT', 'ALLOWED_FINDING', 'DUPLICATE_FINDING', 'FINDING_ORDER'}
            require(isinstance(code, str) and (code in safe or re.fullmatch(r'HTTP_[1-5][0-9]{2}', code)), 'ERROR_CODE')
            if observation['status'] == 'unattempted':
                require(code == 'NOT_ATTEMPTED', 'ERROR_STATUS')
            elif observation['status'] == 'technical_failure':
                require(code in ('TRANSPORT_ERROR', 'INTERRUPTED') or code.startswith('HTTP_'), 'ERROR_STATUS')
            else:
                require(code in safe - {'TRANSPORT_ERROR', 'INTERRUPTED', 'NOT_ATTEMPTED'}, 'ERROR_STATUS')
    require(seen == wanted, 'MISSING_OBSERVATIONS')
    require(type(result['complete']) is bool and result['complete'] == all(o['status'] == 'success' for o in result['observations']), 'COMPLETE_MISMATCH')
    require(result['metrics'] == score(result), 'METRICS_MISMATCH')


def score(result):
    observations = {(o['engine'], o['probe'], o['caseId']): o for o in result['observations']}
    engines = result['engines']
    sources = sorted({c['source'] for c in result['cases']})
    metrics = {'detection': {}, 'verdict': {}, 'coverage': {}, 'pairedSuccesses': {}}
    for source in sources + ['ALL']:
        cases = [c for c in result['cases'] if source == 'ALL' or c['source'] == source]
        metrics['detection'][source], metrics['verdict'][source] = {}, {}
        metrics['coverage'][source], metrics['pairedSuccesses'][source] = {}, {}
        for probe in ('detection', 'policy'):
            paired = [c for c in cases if all(observations[(e, probe, c['id'])]['status'] == 'success' for e in engines)]
            metrics['pairedSuccesses'][source][probe] = len(paired)
            for engine in engines:
                own = [observations[(engine, probe, c['id'])] for c in cases]
                counts = {s: sum(o['status'] == s for o in own) for s in
                          ('success', 'technical_failure', 'contract_failure', 'unattempted')}
                metrics['coverage'][source][engine + '/' + probe] = {
                    'planned': len(cases), 'attempted': len(cases) - counts['unattempted'], **counts}
                if probe == 'policy':
                    known = [c for c in paired if expected_verdict(c) is not None]
                    metrics['verdict'][source][engine] = binary_metrics(
                        [expected_verdict(c) == 'rejected' for c in known],
                        [observations[(engine, probe, c['id'])]['response']['verdict'] == 'rejected' for c in known])
                    metrics['verdict'][source][engine]['unknownExcluded'] = len(paired) - len(known)
                else:
                    metrics['detection'][source][engine] = {}
                    for category in CATALOG:
                        expected, observed = [], []
                        unknown = 0
                        for case in paired:
                            detected = {(f['fieldId'], f['category']) for f in observations[(engine, probe, case['id'])]['response']['findings']}
                            for field in case['fields']:
                                if category in field.get('unknown', []):
                                    unknown += 1
                                    continue
                                expected.append(category in field['expected'])
                                observed.append((field['fieldId'], category) in detected)
                        matrix = binary_metrics(expected, observed)
                        matrix['unknownExcluded'] = unknown
                        metrics['detection'][source][engine][category] = matrix
    return metrics


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


# No redirects or implicit retries: each observation is one POST to its engine.
open_http = urllib.request.build_opener(NoRedirect()).open


def collect(cases, endpoints, timeout=30.0):
    validate_cases(cases)
    require(set(endpoints) == set(ENGINES) and 0 < timeout < float('inf'), 'COLLECT_CONFIG')
    result = {'schemaVersion': 2, 'catalog': CATALOG, 'engines': ENGINES, 'heldout': False,
              'cases': project_cases(cases), 'observations': []}
    result['inventory'] = inventory(result['cases'])
    interrupted = False
    for case in cases:
        for probe in ('detection', 'policy'):
            for engine in ENGINES:
                observation: dict = dict(caseId=case['id'], engine=engine, probe=probe)
                if interrupted:
                    observation.update(status='unattempted', errorCode='NOT_ATTEMPTED')
                    result['observations'].append(observation)
                    continue
                try:
                    request = urllib.request.Request(endpoints[engine].rstrip('/') + '/v1/analyze',
                        data=json.dumps(payload_for(case, probe), ensure_ascii=False).encode('utf-8'),
                        headers={'Content-Type': 'application/json'}, method='POST')
                    with open_http(request, timeout=timeout) as response:
                        if response.status != 200:
                            raise urllib.error.HTTPError(request.full_url, response.status, '', response.headers, None)
                        data = response.read(1_000_001)
                    require(len(data) <= 1_000_000, 'RESPONSE_TOO_LARGE')
                    try:
                        body = json.loads(data.decode('utf-8'), object_pairs_hook=unique_object)
                    except (json.JSONDecodeError, UnicodeError, RecursionError):
                        raise ValueError('INVALID_JSON') from None
                    observation.update(project_response(body, case, probe), status='success')
                except KeyboardInterrupt:
                    observation.update(status='technical_failure', errorCode='INTERRUPTED')
                    interrupted = True
                except urllib.error.HTTPError as error:
                    observation.update(status='technical_failure', errorCode='HTTP_' + str(error.code))
                except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
                    observation.update(status='technical_failure', errorCode='TRANSPORT_ERROR')
                except ValueError as error:
                    observation.update(status='contract_failure', errorCode=str(error))
                result['observations'].append(observation)
    result['metrics'] = score(result)
    result['complete'] = all(o['status'] == 'success' for o in result['observations'])
    validate_result(result)
    return result


def binary_metrics(expected, observed):
    if len(expected) != len(observed):
        raise ValueError('METRIC_LENGTH_MISMATCH')
    tp = sum(a and b for a, b in zip(expected, observed))
    fn = sum(a and not b for a, b in zip(expected, observed))
    fp = sum(not a and b for a, b in zip(expected, observed))
    tn = sum(not a and not b for a, b in zip(expected, observed))
    ratio = lambda a, b: a / b if b else None
    recall, specificity = ratio(tp, tp + fn), ratio(tn, tn + fp)
    return dict(n=len(expected), positive=tp + fn, negative=tn + fp,
                tp=tp, fp=fp, fn=fn, tn=tn, recall=recall,
                precision=ratio(tp, tp + fp), specificity=specificity,
                accuracy=ratio(tp + tn, len(expected)),
                balancedAccuracy=(recall + specificity) / 2 if recall is not None and specificity is not None else None,
                falseAcceptanceRate=ratio(fn, tp + fn), falseRejectionRate=ratio(fp, tn + fp))


def table_rows(result):
    tables = {name: [] for name in ('detection', 'verdict', 'coverage', 'observations')}
    for source, engines in result['metrics']['detection'].items():
        for engine, categories in engines.items():
            for category, values in categories.items():
                tables['detection'].append(dict(source=source, engine=engine, category=category, **values))
    for source, engines in result['metrics']['verdict'].items():
        for engine, values in engines.items():
            tables['verdict'].append(dict(source=source, engine=engine, **values))
    for source, entries in result['metrics']['coverage'].items():
        for key, values in entries.items():
            engine, probe = key.split('/')
            tables['coverage'].append(dict(source=source, engine=engine, probe=probe, **values))
    for observation in result['observations']:
        tables['observations'].append({key: (json.dumps(value, sort_keys=True) if isinstance(value, (list, dict)) else value)
                                       for key, value in observation.items()})
    return tables


def markdown_table(rows, columns):
    def cell(value):
        if value is None:
            return 'N/A'
        if isinstance(value, float):
            return f'{value:.4f}'
        return str(value).replace('|', '\\|').replace('\n', ' ')
    return '\n'.join(['| ' + ' | '.join(columns) + ' |',
                      '| ' + ' | '.join('---' for _ in columns) + ' |'] +
                     ['| ' + ' | '.join(cell(row.get(key)) for key in columns) + ' |' for row in rows])


def write_reports(result, output):
    validate_result(result)
    tables = table_rows(result)
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    for name, rows in tables.items():
        columns = list(dict.fromkeys(key for row in rows for key in row))
        with (output / (name + '.csv')).open('w', newline='', encoding='utf-8') as stream:
            writer = csv.DictWriter(stream, fieldnames=columns)
            writer.writeheader()
            writer.writerows(rows)
    report = ['# Uniform three-engine pilot', '', 'Complete: ' + str(result['complete']), '',
        'Detection: deny-all POST; category presence per case/field, not spans or entity counts. '
        'Policy: separate HTTP POST with field allowlists. Same closed nine-category API for all engines. '
        'No inferred or normalized verdicts. Matrices use successful requests paired across ALL THREE engines, separately per probe. '
        'Unknown pairs are excluded, never TN; zero denominators are N/A.', '',
        '## Source inventory', '', markdown_table([dict(source=s, **v) for s, v in result['inventory'].items()],
            ['source', 'cases', 'fields', 'distinctTexts', 'families', 'unknownPairs']), '',
        '## Coverage (own successes; failures never scored)', '', markdown_table(tables['coverage'],
            ['source', 'engine', 'probe', 'planned', 'attempted', 'success', 'technical_failure', 'contract_failure', 'unattempted']), '',
        '## Paired successes', '', markdown_table([dict(source=s, **v) for s, v in result['metrics']['pairedSuccesses'].items()],
            ['source', 'detection', 'policy']), '',
        '## Detection', '', markdown_table(tables['detection'],
            ['source', 'engine', 'category', 'n', 'positive', 'negative', 'tp', 'fp', 'fn', 'tn', 'recall', 'precision', 'accuracy', 'balancedAccuracy', 'unknownExcluded']), '',
        '## Observed HTTP verdict (positive = rejected)', '', markdown_table(tables['verdict'],
            ['source', 'engine', 'n', 'positive', 'negative', 'tp', 'fp', 'fn', 'tn', 'recall', 'precision', 'accuracy',
             'balancedAccuracy', 'falseAcceptanceRate', 'falseRejectionRate', 'unknownExcluded']), '',
        '## Limitations', '',
        'Non-heldout development pilot: original inputs were already evaluated; legacy families and policy variants are correlated. '
        'Repeated policy scenarios also repeat detection probes and weight the case/field matrices. '
        'Distinct texts and family counts are not independent sample sizes. No production representativeness, unseen-training claim, '
        'performance measurement or detector-quality gate. Accepted is not proof of absence of personal data. '
        'This bundle validates structure and internal consistency, not authenticity against coordinated edits.', '']
    (output / 'report.md').write_text('\n'.join(report), encoding='utf-8')


def gold_counts(gold):
    cases = gold['cases']
    fields = [f for c in cases for f in c['fields']]
    verdicts = [expected_verdict(c) for c in cases]
    return {**inventory(project_cases(cases))['ALL'], 'sources': inventory(project_cases(cases)),
            'maxFields': max(len(c['fields']) for c in cases), 'maxWhitespaceWords': max(words(f['text']) for f in fields),
            'plannedHttpRequests': len(cases) * 6,
            'policyExpected': {v or 'unknown': verdicts.count(v) for v in ('accepted', 'rejected', None)},
            'support': {category: {'positive': sum(category in f['expected'] for f in fields),
                                   'unknown': sum(category in f['unknown'] for f in fields),
                                   'negative': sum(category not in f['expected'] + f['unknown'] for f in fields)}
                        for category in CATALOG}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gold', type=Path, default=Path(__file__).with_name('gold.json'))
    for engine in ENGINES:
        parser.add_argument('--' + engine + '-url')
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--render', type=Path, help='Offline render of version 2 only; historical files stay historical')
    parser.add_argument('--validate-only', action='store_true', help='Read-only offline gold preflight')
    args = parser.parse_args(argv)
    endpoints = {e: getattr(args, e + '_url') for e in ENGINES}
    if args.validate_only and (args.render or any(endpoints.values()) or args.output):
        parser.error('--validate-only requires no endpoints, render or output')
    if args.render and any(endpoints.values()):
        parser.error('--render is offline')
    if not args.validate_only and not args.output:
        parser.error('--output is required')
    if not args.render and not args.validate_only and not all(endpoints.values()):
        parser.error('All three engine URLs are required')
    if not 0 < args.timeout < float('inf'):
        parser.error('--timeout must be positive and finite')
    try:
        if args.render:
            result = json.loads(args.render.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
            validate_result(result)
            args.output.mkdir(parents=True, exist_ok=False)
        else:
            gold = json.loads(args.gold.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
            validate_gold(gold)
            if args.validate_only:
                print(json.dumps(gold_counts(gold), indent=2))
                return 0
            args.output.mkdir(parents=True, exist_ok=False)
            result = collect(gold['cases'], endpoints, args.timeout)
        write_reports(result, args.output)
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        print('RUN_FAILED: invalid input or output unavailable; no raw text logged.', file=sys.stderr)
        return 3
    print(json.dumps({'complete': result['complete'], 'observations': len(result['observations'])}))
    return 0 if result['complete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
