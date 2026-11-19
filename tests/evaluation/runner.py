"""BardsAI category-detection golden runner; standard library only."""
import argparse
import csv
import http.client
import json
import math
import os
from pathlib import Path
import sys
import urllib.error
import urllib.request

CATALOG = ['PERSON', 'EMAIL_ADDRESS', 'PHONE_NUMBER', 'IT_FISCAL_CODE',
           'IT_VAT_CODE', 'IBAN_CODE', 'CREDIT_CARD', 'IT_IDENTITY_CARD', 'IT_DRIVER_LICENSE']
ENGINES = ['bardsai']
GOLD_VERSION = 'category-detection-1'
PROJECT_ROOT = Path(__file__).resolve().parents[2]
OUTPUT_NAMES = ('results.json', 'summary.csv', 'verdict.csv', 'category.csv',
                'differences.csv', 'report.md')


def require(condition, code):
    if not condition:
        raise ValueError(code)


def valid_string(value):
    return isinstance(value, str) and bool(value) and not any(0xD800 <= ord(c) <= 0xDFFF for c in value)


def canonical_categories(value):
    require(isinstance(value, list) and all(valid_string(x) for x in value), 'LABELS')
    require(len(value) == len(set(value)), 'DUPLICATE_LABEL')
    require(set(value) <= set(CATALOG), 'UNKNOWN_LABEL')
    require(value == [x for x in CATALOG if x in value], 'LABEL_ORDER')


def validate_cases(cases):
    require(isinstance(cases, list) and bool(cases), 'CASES')
    ids = set()
    for case in cases:
        require(isinstance(case, dict) and set(case) == {'id', 'text', 'expected'}, 'CASE_SCHEMA')
        require(valid_string(case['id']) and case['id'] not in ids, 'CASE_ID')
        ids.add(case['id'])
        require(valid_string(case['text']), 'TEXT')
        canonical_categories(case['expected'])


def validate_gold(gold):
    require(isinstance(gold, dict) and set(gold) == {'schemaVersion', 'goldVersion', 'catalog', 'cases'}, 'GOLD_SCHEMA')
    require(gold['schemaVersion'] == 3 and gold['goldVersion'] == GOLD_VERSION, 'GOLD_VERSION')
    require(gold['catalog'] == CATALOG, 'CATALOG')
    validate_cases(gold['cases'])


def payload_for(case):
    return {'fields': [{'fieldId': 'text', 'text': case['text'], 'allowedCategories': []}]}


def wire_findings(categories):
    return [{'fieldId': 'text', 'category': category}
            for category in sorted(categories, key=lambda value: value.encode('utf-16-be'))]


def expected_response(case):
    findings = wire_findings(case['expected'])
    return {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}


def project_response(body):
    require(isinstance(body, dict) and set(body) == {'verdict', 'findings'}, 'RESPONSE_SCHEMA')
    require(body['verdict'] in ('accepted', 'rejected') and isinstance(body['findings'], list), 'RESPONSE_SCHEMA')
    pairs = []
    for finding in body['findings']:
        require(isinstance(finding, dict) and set(finding) == {'fieldId', 'category'}, 'FINDING_SCHEMA')
        require(finding['fieldId'] == 'text' and finding['category'] in CATALOG, 'FINDING_SCHEMA')
        pairs.append((finding['fieldId'], finding['category']))
    require(len(pairs) == len(set(pairs)), 'DUPLICATE_FINDING')
    require(pairs == sorted(pairs, key=lambda p: (p[0].encode('utf-16-be'), p[1].encode('utf-16-be'))), 'FINDING_ORDER')
    require((body['verdict'] == 'rejected') == bool(body['findings']), 'INCONSISTENT_VERDICT')
    found = {category for _, category in pairs}
    return [category for category in CATALOG if category in found]


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, 'DUPLICATE_JSON_KEY')
        result[key] = value
    return result


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


open_http = urllib.request.build_opener(NoRedirect()).open


def request_once(endpoint, case, timeout):
    request = urllib.request.Request(endpoint.rstrip('/') + '/v1/analyze',
        data=json.dumps(payload_for(case), ensure_ascii=False).encode('utf-8'),
        headers={'Content-Type': 'application/json'}, method='POST')
    try:
        with open_http(request, timeout=timeout) as response:
            require(response.status == 200, 'HTTP_' + str(response.status))
            data = response.read(1_000_001)
        require(len(data) <= 1_000_000, 'RESPONSE_TOO_LARGE')
    except urllib.error.HTTPError as error:
        raise ValueError('HTTP_' + str(error.code)) from None
    except (urllib.error.URLError, TimeoutError, OSError, http.client.HTTPException):
        raise ValueError('TRANSPORT_ERROR') from None
    try:
        return json.loads(data.decode('utf-8'), object_pairs_hook=unique_object)
    except (json.JSONDecodeError, UnicodeError, RecursionError):
        raise ValueError('INVALID_JSON') from None


def collect(cases, endpoints, timeout=30.0):
    validate_cases(cases)
    require(set(endpoints) == set(ENGINES) and all(valid_string(endpoints[e]) for e in ENGINES), 'COLLECT_CONFIG')
    require(isinstance(timeout, (int, float)) and math.isfinite(timeout) and timeout > 0, 'COLLECT_CONFIG')
    observations = []
    for case in cases:
        expected = expected_response(case)
        for engine in ENGINES:
            body = request_once(endpoints[engine], case, timeout)
            observed_categories = project_response(body)
            observations.append({
                'caseId': case['id'],
                'engine': engine,
                'expectedVerdict': expected['verdict'],
                'observedVerdict': body['verdict'],
                'expectedCategories': case['expected'],
                'observedCategories': observed_categories,
                'verdictCorrect': body['verdict'] == expected['verdict'],
                'bodyExact': body == expected,
            })
    result = {'schemaVersion': 3, 'goldVersion': GOLD_VERSION, 'catalog': CATALOG,
              'engines': ENGINES, 'caseCount': len(cases), 'observations': observations}
    validate_result(result)
    return result


def validate_result(result):
    root = {'schemaVersion', 'goldVersion', 'catalog', 'engines', 'caseCount', 'observations'}
    require(isinstance(result, dict) and set(result) == root, 'RESULT_SCHEMA')
    require(result['schemaVersion'] == 3 and result['goldVersion'] == GOLD_VERSION, 'RESULT_VERSION')
    require(result['catalog'] == CATALOG and result['engines'] == ENGINES, 'RESULT_CATALOG')
    require(type(result['caseCount']) is int and result['caseCount'] > 0, 'CASE_COUNT')
    observations = result['observations']
    require(isinstance(observations, list) and len(observations) == result['caseCount'] * len(ENGINES), 'OBSERVATION_COUNT')
    keys = {'caseId', 'engine', 'expectedVerdict', 'observedVerdict', 'expectedCategories',
            'observedCategories', 'verdictCorrect', 'bodyExact'}
    case_ids = set()
    for index in range(result['caseCount']):
        block = observations[index * len(ENGINES):(index + 1) * len(ENGINES)]
        require([o.get('engine') for o in block if isinstance(o, dict)] == ENGINES, 'OBSERVATION_ORDER')
        require(all(isinstance(o, dict) and set(o) == keys for o in block), 'OBSERVATION_SCHEMA')
        case_id = block[0]['caseId']
        require(valid_string(case_id) and case_id not in case_ids and all(o['caseId'] == case_id for o in block), 'OBSERVATION_ID')
        case_ids.add(case_id)
        expected_categories = block[0]['expectedCategories']
        canonical_categories(expected_categories)
        expected_verdict = 'rejected' if expected_categories else 'accepted'
        for observation in block:
            canonical_categories(observation['observedCategories'])
            require(observation['expectedCategories'] == expected_categories, 'EXPECTED_MISMATCH')
            require(observation['expectedVerdict'] == expected_verdict, 'EXPECTED_VERDICT')
            require(observation['observedVerdict'] in ('accepted', 'rejected'), 'OBSERVED_VERDICT')
            require((observation['observedVerdict'] == 'rejected') == bool(observation['observedCategories']), 'OBSERVED_CONSISTENCY')
            require(type(observation['verdictCorrect']) is bool and type(observation['bodyExact']) is bool, 'RESULT_FLAGS')
            require(observation['verdictCorrect'] == (observation['observedVerdict'] == expected_verdict), 'VERDICT_FLAG')
            exact = observation['verdictCorrect'] and observation['observedCategories'] == expected_categories
            require(observation['bodyExact'] == exact, 'BODY_FLAG')


def binary_metrics(expected, observed):
    require(len(expected) == len(observed), 'METRIC_LENGTH_MISMATCH')
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


def score(result):
    validate_result(result)
    metrics = {'summary': {}, 'verdict': {}, 'categories': {}}
    for engine in ENGINES:
        own = [o for o in result['observations'] if o['engine'] == engine]
        verdict_correct = sum(o['verdictCorrect'] for o in own)
        body_match = sum(o['bodyExact'] for o in own)
        metrics['summary'][engine] = {'cases': len(own), 'verdictCorrect': verdict_correct,
            'verdictIncorrect': len(own) - verdict_correct, 'bodyMatch': body_match,
            'bodyMismatch': len(own) - body_match}
        metrics['verdict'][engine] = binary_metrics(
            [o['expectedVerdict'] == 'rejected' for o in own],
            [o['observedVerdict'] == 'rejected' for o in own])
        metrics['categories'][engine] = {}
        for category in CATALOG:
            metrics['categories'][engine][category] = binary_metrics(
                [category in o['expectedCategories'] for o in own],
                [category in o['observedCategories'] for o in own])
    return metrics


def markdown_table(rows, columns):
    def cell(value):
        if value is None: return 'N/A'
        if isinstance(value, float): return f'{value:.4f}'
        return str(value).replace('|', '\\|').replace('\n', ' ')
    return '\n'.join(['| ' + ' | '.join(columns) + ' |',
                      '| ' + ' | '.join('---' for _ in columns) + ' |'] +
                     ['| ' + ' | '.join(cell(row.get(key)) for key in columns) + ' |' for row in rows])


def write_csv(path, rows):
    columns = list(dict.fromkeys(key for row in rows for key in row))
    with path.open('w', newline='', encoding='utf-8') as stream:
        writer = csv.DictWriter(stream, fieldnames=columns)
        writer.writeheader(); writer.writerows(rows)


def write_reports(result, output, create=True):
    validate_result(result)
    metrics = score(result)
    if create:
        output.mkdir(parents=True, exist_ok=False)
    else:
        require(output.is_dir(), 'OUTPUT_UNAVAILABLE')
    (output / 'results.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    summary = [dict(engine=engine, **values) for engine, values in metrics['summary'].items()]
    verdict = [dict(engine=engine, **values) for engine, values in metrics['verdict'].items()]
    categories = [dict(engine=engine, category=category, **values)
                  for engine, entries in metrics['categories'].items() for category, values in entries.items()]
    differences = [o for o in result['observations'] if not o['bodyExact']]
    write_csv(output / 'summary.csv', summary)
    write_csv(output / 'verdict.csv', verdict)
    write_csv(output / 'category.csv', categories)
    write_csv(output / 'differences.csv', differences)
    report = ['# Category-detection golden comparison', '',
        f'Gold: `{result["goldVersion"]}` — {result["caseCount"]} cases, {len(result["observations"])} successful HTTP responses.', '',
        'Each case is sent once per engine with `allowedCategories: []`. Metrics compare the observed HTTP business verdict, '
        'the complete `{verdict, findings}` body and category presence. Technical or contract failures abort the run and are never scored.', '',
        '## Summary', '', markdown_table(summary, ['engine','cases','verdictCorrect','verdictIncorrect','bodyMatch','bodyMismatch']), '',
        '## Verdict (positive = rejected)', '', markdown_table(verdict,
            ['engine','n','positive','negative','tp','fp','fn','tn','recall','precision','accuracy','balancedAccuracy','falseAcceptanceRate','falseRejectionRate']), '',
        '## Categories', '', markdown_table(categories,
            ['engine','category','n','positive','negative','tp','fp','fn','tn','recall','precision','accuracy','balancedAccuracy']), '',
        '## Differences', '', markdown_table(differences,
            ['caseId','engine','expectedVerdict','observedVerdict','expectedCategories','observedCategories']), '',
        '## Scope', '',        'Category presence per complete text; no span or entity-count scoring. The corpus is a development oracle, '
        'not a held-out estimate of production representativeness. Accepted is not proof that a text contains no personal data.', '']
    (output / 'report.md').write_text('\n'.join(report), encoding='utf-8')


def gold_counts(gold):
    return {'cases': len(gold['cases']), 'plannedHttpRequests': len(gold['cases']) * len(ENGINES),
            'support': {category: {'positive': sum(category in case['expected'] for case in gold['cases']),
                                  'negative': sum(category not in case['expected'] for case in gold['cases'])}
                        for category in CATALOG}}


def output_destination(path, project_root=PROJECT_ROOT):
    require(not os.path.lexists(path), 'OUTPUT_EXISTS')
    if path.parent.is_dir() and os.access(path.parent, os.W_OK):
        return path, True
    require(project_root.is_dir() and os.access(project_root, os.W_OK), 'OUTPUT_UNAVAILABLE')
    require(all(not os.path.lexists(project_root / name) for name in OUTPUT_NAMES), 'OUTPUT_EXISTS')
    return project_root, False


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--gold', type=Path, default=Path(__file__).with_name('gold.json'))
    for engine in ENGINES: parser.add_argument('--' + engine + '-url')
    parser.add_argument('--timeout', type=float, default=30.0)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--render', type=Path, help='Offline render of result schema version 3')
    parser.add_argument('--validate-only', action='store_true', help='Read-only offline gold preflight')
    args = parser.parse_args(argv)
    endpoints = {engine: getattr(args, engine + '_url') for engine in ENGINES}
    if args.validate_only and (args.render or any(endpoints.values()) or args.output): parser.error('--validate-only is standalone')
    if args.render and any(endpoints.values()): parser.error('--render is offline')
    if not args.validate_only and not args.output: parser.error('--output is required')
    if not args.render and not args.validate_only and not all(endpoints.values()): parser.error('All three engine URLs are required')
    if not math.isfinite(args.timeout) or args.timeout <= 0: parser.error('--timeout must be positive and finite')
    try:
        if args.validate_only:
            gold = json.loads(args.gold.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
            validate_gold(gold)
            print(json.dumps(gold_counts(gold), indent=2))
            return 0
        output, create_output = output_destination(args.output)
        if args.render:
            result = json.loads(args.render.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
            validate_result(result)
        else:
            gold = json.loads(args.gold.read_text(encoding='utf-8'), object_pairs_hook=unique_object)
            validate_gold(gold)
            result = collect(gold['cases'], endpoints, args.timeout)
        write_reports(result, output, create_output)
    except (OSError, ValueError, KeyError, TypeError, RecursionError):
        print('RUN_FAILED: invalid input, HTTP response or output unavailable; no raw text logged.', file=sys.stderr)
        return 3
    print(json.dumps({'observations': len(result['observations'])}))
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
