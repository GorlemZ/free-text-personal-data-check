"""Small presence-level pilot: no model imports or service lifecycle actions."""
import argparse
import csv
import json
import sys
from pathlib import Path
import urllib.request
import urllib.error

CATALOG = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE',
           'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']
# Semantic identities are not an assertion of runtime recognizer availability.
NATIVE = {category: category for category in CATALOG}
BASELINE_VERSION = 'it-spacy-sm-3.8.0-poc1'


FIELD_IDS = {'description', 'contactName', 'serverUrls[].description', 'eserviceName',
             'eserviceDescription', 'intendedTarget', 'purposeDescription', 'freeOfChargeReason',
             'riskAnalysisAnswer', 'consumerNotes', 'rejectAgreementReason'}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def labels(value, allowed=None):
    require(isinstance(value, list) and all(isinstance(x, str) and x for x in value), 'LABELS')
    require(len(value) == len(set(value)), 'DUPLICATE_LABEL')
    if allowed is not None:
        require(set(value) <= set(allowed), 'UNKNOWN_LABEL')


def validate_capabilities(capabilities):
    require(isinstance(capabilities, dict) and set(capabilities) == {
        'schemaVersion', 'modelPolicyVersion', 'supportedEntities', 'nativeToCategory', 'evidence'}, 'CAPABILITIES_SCHEMA')
    require(capabilities['schemaVersion'] == 1 and capabilities['modelPolicyVersion'] == BASELINE_VERSION, 'VERSION_MISMATCH')
    labels(capabilities['supportedEntities'])
    # Version 1 reading contract is frozen: no inferred aliases or cross-category mappings.
    mapping = capabilities['nativeToCategory']
    require(isinstance(mapping, dict) and mapping == {
        c: c for c in CATALOG if c in capabilities['supportedEntities']}, 'CAPABILITY_MAPPING')
    evidence = capabilities['evidence']
    require(isinstance(evidence, dict) and set(evidence) == {'kind', 'method', 'scope'} and
            all(isinstance(v, str) and v for v in evidence.values()), 'CAPABILITY_EVIDENCE')


def load_capabilities(path=None):
    capabilities = json.loads((path or Path(__file__).with_name('baseline-capabilities.json')).read_text(encoding='utf-8'))
    validate_capabilities(capabilities)
    return capabilities


def validate_cases(cases, with_text=True):
    require(isinstance(cases, list) and bool(cases), 'CASES')
    ids = set()
    for case in cases:
        require(isinstance(case, dict), 'CASE_SCHEMA')
        require(isinstance(case.get('id'), str) and case['id'] and case['id'] not in ids, 'CASE_ID')
        ids.add(case['id'])
        require(case.get('source') in ('rizzo', 'gretel', 'targeted'), 'SOURCE')
        require(isinstance(case.get('fields'), list) and 1 <= len(case['fields']) <= 10, 'FIELD_LIMIT')
        field_ids = set()
        for field in case['fields']:
            required = {'fieldId', 'expected', 'unknown', 'allowedCategories'} | ({'text'} if with_text else set())
            require(isinstance(field, dict) and set(field) == required, 'FIELD_SCHEMA')
            field_id = field['fieldId']
            require(isinstance(field_id, str) and field_id in FIELD_IDS and field_id not in field_ids, 'FIELD_ID')
            field_ids.add(field_id)
            for key in ('expected', 'unknown', 'allowedCategories'):
                labels(field[key], CATALOG)
            require(set(field['expected']).isdisjoint(field['unknown']), 'CONTRADICTORY_GOLD')
            if with_text:
                text = field['text']
                require(isinstance(text, str) and len(text.split()) <= 50 and len(text) <= 2000 and
                        len(text.encode('utf-8')) <= 8000, 'TEXT_LIMIT')


def validate_gold(gold):
    require(isinstance(gold, dict) and gold.get('schemaVersion') == 1 and gold.get('catalog') == CATALOG
            and gold.get('frozenBeforeInference') is True, 'GOLD_SCHEMA')
    validate_cases(gold.get('cases'))


def validate_result(result):
    require(isinstance(result, dict) and set(result) == {
        'schemaVersion', 'catalog', 'engines', 'cases', 'observations', 'metrics', 'complete', 'baselineCapabilities'}, 'RESULT_SCHEMA')
    require(result['schemaVersion'] == 1 and result['catalog'] == CATALOG, 'RESULT_VERSION')
    labels(result['engines'], ['new', 'baseline'])
    require(bool(result['engines']), 'ENGINES')
    validate_capabilities(result['baselineCapabilities'])
    validate_cases(result['cases'], with_text=False)
    require(all(set(c) == {'id', 'source', 'fields'} for c in result['cases']), 'CASE_SCHEMA')
    require(isinstance(result['observations'], list), 'OBSERVATIONS')
    cases = {c['id']: c for c in result['cases']}
    wanted = {(e, p, c) for e in result['engines'] for p in ('detection', 'policy') for c in cases}
    seen = set()
    for observation in result['observations']:
        require(isinstance(observation, dict), 'OBSERVATION_SCHEMA')
        base = {'caseId', 'engine', 'probe', 'status'}
        require(base <= set(observation), 'OBSERVATION_SCHEMA')
        key = (observation['engine'], observation['probe'], observation['caseId'])
        require(all(isinstance(x, str) for x in key) and key in wanted and key not in seen, 'OBSERVATION_ID')
        seen.add(key)
        status = observation['status']
        if status == 'success':
            require(set(observation) == base | {'rawVerdict', 'findings', 'extras', 'modelPolicyVersion'}, 'OBSERVATION_SCHEMA')
            engine, probe, case_id = key
            require(isinstance(observation['findings'], list) and isinstance(observation['extras'], list), 'FINDING_SCHEMA')
            if engine == 'new':
                require(not observation['extras'] and observation['modelPolicyVersion'] is None, 'NEW_EXTRAS')
            label_key = 'entityType' if engine == 'baseline' else 'category'
            findings = []
            for item in observation['findings']:
                require(isinstance(item, dict) and set(item) == {'fieldId', 'category'} and item['category'] in CATALOG, 'FINDING_SCHEMA')
                findings.append({'fieldId': item['fieldId'], label_key: item['category']})
            for item in observation['extras']:
                require(isinstance(item, dict) and set(item) == {'fieldId', 'label'} and item['label'] not in CATALOG, 'EXTRA_SCHEMA')
                findings.append({'fieldId': item['fieldId'], label_key: item['label']})
            body = {'verdict': observation['rawVerdict'], 'findings': findings}
            if engine == 'baseline':
                body['modelPolicyVersion'] = observation['modelPolicyVersion']
            projected = project_response(body, cases[case_id], engine, probe, result['baselineCapabilities'])
            require(all(observation[k] == v for k, v in projected.items()), 'PROJECTION_MISMATCH')
        else:
            require(status in ('technical_failure', 'contract_failure', 'unattempted') and
                    set(observation) == base | {'errorCode'}, 'OBSERVATION_SCHEMA')
            code = observation['errorCode']
            safe_codes = {'TRANSPORT_ERROR', 'INTERRUPTED', 'NOT_ATTEMPTED', 'INVALID_JSON', 'DUPLICATE_JSON_KEY',
                          'RESPONSE_TOO_LARGE', 'RESPONSE_SCHEMA', 'VERSION_MISMATCH', 'FINDING_SCHEMA',
                          'UNKNOWN_CATEGORY', 'INCONSISTENT_VERDICT', 'ALLOWED_FINDING', 'UNSUPPORTED_NATIVE', 'DUPLICATE_FINDING'}
            require(isinstance(code, str) and (code in safe_codes or
                    (code.startswith('HTTP_') and len(code) == 8 and code[5:].isdigit())), 'ERROR_CODE')
    require(seen == wanted, 'MISSING_OBSERVATIONS')
    require(isinstance(result['complete'], bool) and result['complete'] ==
            all(o['status'] == 'success' for o in result['observations']), 'COMPLETE_MISMATCH')
    require(result['metrics'] == score(result), 'METRICS_MISMATCH')


def expected_verdict(case):
    if any(set(f['expected']) - set(f.get('allowedCategories', [])) for f in case['fields']):
        return 'rejected'
    if any(set(f.get('unknown', [])) - set(f.get('allowedCategories', [])) for f in case['fields']):
        return None
    return 'accepted'


def payload_for(case, engine, probe, capabilities=None):
    mapping = (capabilities or load_capabilities())['nativeToCategory'] if engine == 'baseline' else NATIVE
    key = 'allowedEntityTypes' if engine == 'baseline' else 'allowedCategories'
    return {'fields': [dict(fieldId=f['fieldId'], text=f['text'], **{
        key: ([native for c in f['allowedCategories'] for native, semantic in mapping.items() if semantic == c]
              if probe == 'policy' else [])}) for f in case['fields']]}


def project_response(body, case, engine, probe='detection', capabilities=None):
    capabilities = capabilities or load_capabilities()
    mapping = capabilities['nativeToCategory'] if engine == 'baseline' else NATIVE
    label_key = 'entityType' if engine == 'baseline' else 'category'
    required = {'verdict', 'findings'} | ({'modelPolicyVersion'} if engine == 'baseline' else set())
    if not isinstance(body, dict) or set(body) != required:
        raise ValueError('RESPONSE_SCHEMA')
    if body['verdict'] not in ('accepted', 'rejected') or not isinstance(body['findings'], list):
        raise ValueError('RESPONSE_SCHEMA')
    if engine == 'baseline' and body['modelPolicyVersion'] != BASELINE_VERSION:
        raise ValueError('VERSION_MISMATCH')
    fields = {f['fieldId'] for f in case['fields']}
    findings, extras = set(), set()
    for finding in body['findings']:
        if not isinstance(finding, dict) or set(finding) != {'fieldId', label_key}:
            raise ValueError('FINDING_SCHEMA')
        field, label = finding['fieldId'], finding[label_key]
        if not isinstance(field, str) or field not in fields or not isinstance(label, str):
            raise ValueError('FINDING_SCHEMA')
        if engine == 'baseline' and label not in capabilities['supportedEntities']:
            raise ValueError('UNSUPPORTED_NATIVE')
        allowed = next(f['allowedCategories'] for f in case['fields'] if f['fieldId'] == field)
        if probe == 'policy' and mapping.get(label) in allowed:
            raise ValueError('ALLOWED_FINDING')
        if label in mapping:
            findings.add((field, mapping[label]))
        elif engine == 'baseline':
            extras.add((field, label))
        else:
            raise ValueError('UNKNOWN_CATEGORY')
    if (body['verdict'] == 'rejected') != bool(body['findings']):
        raise ValueError('INCONSISTENT_VERDICT')
    return {'rawVerdict': body['verdict'],
            'findings': [dict(fieldId=f, category=c) for f, c in sorted(findings)],
            'extras': [dict(fieldId=f, label=c) for f, c in sorted(extras)],
            'modelPolicyVersion': body.get('modelPolicyVersion')}


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
                        [observations[(engine, probe, c['id'])]['rawVerdict'] == 'rejected' for c in known])
                    metrics['verdict'][source][engine]['unknownExcluded'] = len(paired) - len(known)
                else:
                    metrics['detection'][source][engine] = {}
                    for category in CATALOG:
                        expected, observed = [], []
                        unknown = 0
                        for case in paired:
                            detected = {(f['fieldId'], f['category']) for f in observations[(engine, probe, case['id'])]['findings']}
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
        if key in result:
            raise ValueError('DUPLICATE_JSON_KEY')
        result[key] = value
    return result


def collect(cases, endpoints, timeout=30.0, capabilities=None):
    validate_cases(cases)
    labels(list(endpoints), ['new', 'baseline'])
    require(bool(endpoints) and 0 < timeout < float('inf'), 'COLLECT_CONFIG')
    capabilities = capabilities or load_capabilities()
    validate_capabilities(capabilities)
    result = {'schemaVersion': 1, 'catalog': CATALOG, 'engines': list(endpoints),
              'baselineCapabilities': capabilities,
              'cases': [{**{k: c[k] for k in ('id', 'source')},
                         'fields': [{k: f[k] for k in ('fieldId', 'expected', 'unknown', 'allowedCategories')}
                                    for f in c['fields']]} for c in cases], 'observations': []}
    interrupted = False
    for case in cases:
        for probe in ('detection', 'policy'):
            for engine, url in endpoints.items():
                observation = dict(caseId=case['id'], engine=engine, probe=probe)
                if interrupted:
                    observation.update(status='unattempted', errorCode='NOT_ATTEMPTED')
                    result['observations'].append(observation)
                    continue
                try:
                    request = urllib.request.Request(url.rstrip('/') + '/v1/analyze',
                        data=json.dumps(payload_for(case, engine, probe, capabilities)).encode(),
                        headers={'Content-Type': 'application/json'}, method='POST')
                    with urllib.request.urlopen(request, timeout=timeout) as response:
                        data = response.read(1_000_001)
                    if len(data) > 1_000_000:
                        raise ValueError('RESPONSE_TOO_LARGE')
                    try:
                        body = json.loads(data, object_pairs_hook=unique_object)
                    except (json.JSONDecodeError, UnicodeError, RecursionError):
                        raise ValueError('INVALID_JSON') from None
                    observation.update(project_response(body, case, engine, probe, capabilities), status='success')
                except KeyboardInterrupt:
                    observation.update(status='technical_failure', errorCode='INTERRUPTED')
                    interrupted = True
                except urllib.error.HTTPError as error:
                    observation.update(status='technical_failure', errorCode='HTTP_' + str(error.code))
                except (urllib.error.URLError, TimeoutError, OSError):
                    observation.update(status='technical_failure', errorCode='TRANSPORT_ERROR')
                except ValueError as error:
                    observation.update(status='contract_failure', errorCode=str(error))
                result['observations'].append(observation)
    result['metrics'] = score(result)
    result['complete'] = all(o['status'] == 'success' for o in result['observations'])
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
        tables['observations'].append({key: (json.dumps(value, sort_keys=True) if isinstance(value, list) else value)
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
    report = ['# External pilot', '', 'Complete: ' + str(result['complete']), '',
        '## Protocol', '',
        'Detection: deny-all requests; category presence per field, not spans or entity counts. '
        'Policy: separate real requests with field allowlists. Paired successes are selected separately for each probe. '
        'Unknown field/category labels are excluded, never counted as TN. Zero denominators are N/A.', '',
        '## Baseline registry evidence', '',
        'Evidence: ' + result['baselineCapabilities']['evidence']['kind'] +
        '; modelPolicyVersion: ' + result['baselineCapabilities']['modelPolicyVersion'] + '.',
        'Unavailable scored categories (not sent in baseline allowlists): ' +
        (', '.join(c for c in CATALOG if c not in result['baselineCapabilities']['nativeToCategory'].values()) or 'none') + '.',
        'Registry support does not prove effective detection. The baseline service/configuration is not modified by this runner.', '',
        '## Coverage', '', markdown_table(tables['coverage'],
            ['source', 'engine', 'probe', 'planned', 'attempted', 'success', 'technical_failure', 'contract_failure', 'unattempted']), '',
        '## Detection (paired successful requests)', '', markdown_table(tables['detection'],
            ['source', 'engine', 'category', 'n', 'positive', 'negative', 'tp', 'fp', 'fn', 'tn', 'recall', 'precision', 'unknownExcluded']), '',
        '## Raw verdict (positive = rejected)', '',
        'The baseline raw verdict is unchanged, including rejection due to out-of-catalog findings. '
        'Gold policy covers only the nine scored categories: this is not an equal-policy comparison. '
        'No normalized verdict table is produced. Extras are preserved in observations; no extra label is allowlisted to soften the baseline.', '',
        markdown_table(tables['verdict'],
            ['source', 'engine', 'n', 'positive', 'negative', 'tp', 'fp', 'fn', 'tn', 'recall', 'precision', 'accuracy',
             'balancedAccuracy', 'falseAcceptanceRate', 'falseRejectionRate', 'unknownExcluded']), '',
        '## Limitations', '',
        'Small selected external/synthetic pilot, not population-representative or independent samples. '
        'Rizzo is not claimed unseen by the Rizzo model. No performance measurements or production quality gate. '
        'Accepted does not establish absence of personal data. See README for exhaustive pre-inference review.', '']
    (output / 'report.md').write_text('\n'.join(report), encoding='utf-8')


def gold_counts(gold):
    cases = gold['cases']
    fields = [f for c in cases for f in c['fields']]
    verdicts = [expected_verdict(c) for c in cases]
    return {'cases': len(cases), 'fields': len(fields), 'distinctTexts': len({f['text'] for f in fields}),
            'sources': {s: sum(c['source'] == s for c in cases) for s in sorted({c['source'] for c in cases})},
            'maxFields': max(len(c['fields']) for c in cases), 'maxWhitespaceWords': max(len(f['text'].split()) for f in fields),
            'unknownPairs': sum(len(f['unknown']) for f in fields), 'plannedHttpRequests': len(cases) * 4,
            'policyExpected': {v or 'unknown': verdicts.count(v) for v in ('accepted', 'rejected', None)},
            'support': {category: {'positive': sum(category in f['expected'] for f in fields),
                                   'unknown': sum(category in f['unknown'] for f in fields),
                                   'negative': sum(category not in f['expected'] + f['unknown'] for f in fields)}
                        for category in CATALOG}}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gold', type=Path, default=Path(__file__).with_name('gold.json'))
    parser.add_argument('--new-url')
    parser.add_argument('--baseline-url')
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--render', type=Path, help='Render a saved bundle without HTTP or the mutable gold')
    parser.add_argument('--validate-only', action='store_true', help='Validate/count gold offline; no output directory or HTTP')
    parser.add_argument('--baseline-capabilities', type=Path, default=Path(__file__).with_name('baseline-capabilities.json'))
    args = parser.parse_args(argv)
    if args.validate_only and (args.render or args.new_url or args.baseline_url):
        parser.error('--validate-only is offline and cannot be combined with render or endpoints')
    if not args.validate_only and not args.output:
        parser.error('--output is required')
    if not args.render and not args.validate_only and (not args.new_url or not args.baseline_url):
        parser.error('--new-url and --baseline-url are required for collection')
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
            capabilities = load_capabilities(args.baseline_capabilities)
            if args.validate_only:
                print(json.dumps(gold_counts(gold), indent=2))
                return 0
            args.output.mkdir(parents=True, exist_ok=False)
            result = collect(gold['cases'], {'new': args.new_url, 'baseline': args.baseline_url}, args.timeout, capabilities)
        write_reports(result, args.output)
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        print('RUN_FAILED: invalid input or output unavailable; no raw text logged.', file=sys.stderr)
        return 3
    print(json.dumps({'complete': result['complete'], 'observations': len(result['observations'])}))
    return 0 if result['complete'] else 2


if __name__ == '__main__':
    raise SystemExit(main())
