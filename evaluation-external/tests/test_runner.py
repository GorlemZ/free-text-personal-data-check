import unittest
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import runner


class MetricsTests(unittest.TestCase):
    def test_asymmetric_confusion_and_undefined_denominators(self):
        result = runner.binary_metrics([True, True, True, False, False], [True, False, False, True, False])
        self.assertEqual({k: result[k] for k in ('tp', 'fp', 'fn', 'tn')}, dict(tp=1, fp=1, fn=2, tn=1))
        self.assertEqual(result['recall'], 1 / 3)
        self.assertEqual(result['precision'], 1 / 2)
        self.assertEqual(result['accuracy'], 2 / 5)
        self.assertEqual(result['balancedAccuracy'], (1 / 3 + 1 / 2) / 2)
        self.assertEqual(result['falseAcceptanceRate'], 2 / 3)
        self.assertEqual(result['falseRejectionRate'], 1 / 2)
        self.assertIsNone(runner.binary_metrics([], [])['precision'])
        self.assertIsNone(runner.binary_metrics([False], [False])['recall'])
        self.assertIsNone(runner.binary_metrics([True], [True])['specificity'])
        with self.assertRaises(ValueError):
            runner.binary_metrics([True], [])


class HttpTests(unittest.TestCase):
    def test_two_probes_real_http_keep_native_verdict_and_extras(self):
        import json
        import threading
        from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
        requests = []
        class Handler(BaseHTTPRequestHandler):
            def log_message(self, *args):
                pass
            def do_POST(self):
                payload = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                requests.append((self.path, payload))
                field = payload['fields'][0]
                baseline = 'allowedEntityTypes' in field
                allowed = field.get('allowedEntityTypes', field.get('allowedCategories'))
                label = 'entityType' if baseline else 'category'
                findings = [] if allowed else [{'fieldId': 'description', label: 'PERSON'}]
                if baseline:
                    findings.append({'fieldId': 'description', label: 'LOCATION'})
                reply = {'verdict': 'rejected' if findings else 'accepted', 'findings': findings}
                if baseline:
                    reply['modelPolicyVersion'] = 'it-spacy-sm-3.8.0-poc1'
                self.send_response(200)
                self.end_headers()
                self.wfile.write(json.dumps(reply).encode())
        server = ThreadingHTTPServer(('127.0.0.1', 0), Handler)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        case = {'id': 'literal-1', 'source': 'targeted', 'fields': [
            {'fieldId': 'description', 'text': 'Il referente è Terenzio Brumati.',
             'expected': ['PERSON'], 'unknown': [], 'allowedCategories': ['PERSON']}]}
        try:
            url = f'http://127.0.0.1:{server.server_port}'
            result = runner.collect([case], {'new': url, 'baseline': url})
        finally:
            server.shutdown()
            server.server_close()
            thread.join()
        self.assertEqual(len(requests), 4)
        self.assertTrue(all(path == '/v1/analyze' for path, _ in requests))
        self.assertTrue(all(body['fields'][0]['text'] == case['fields'][0]['text'] for _, body in requests))
        baseline = next(o for o in result['observations'] if o['engine'] == 'baseline' and o['probe'] == 'policy')
        self.assertEqual(baseline['rawVerdict'], 'rejected')
        self.assertEqual(baseline['findings'], [])
        self.assertEqual(baseline['extras'], [{'fieldId': 'description', 'label': 'LOCATION'}])
        self.assertNotIn(case['fields'][0]['text'], json.dumps(result))
        self.assertEqual(result['metrics']['verdict']['targeted']['baseline']['fp'], 1)
        self.assertEqual(result['metrics']['detection']['targeted']['new']['PERSON']['tp'], 1)


if __name__ == '__main__':
    unittest.main()
