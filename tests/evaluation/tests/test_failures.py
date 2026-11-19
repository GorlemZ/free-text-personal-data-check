"""Transport/contract failures must not become classification results."""
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT))
sys.path.insert(0,str(Path(__file__).resolve().parent))
import runner
from test_cli import cli, endpoint_args, fake_servers, gold_fixture


class FailureTests(unittest.TestCase):
    def test_http_or_contract_failure_aborts_without_final_bundle(self):
        for mode in ('http','json','schema'):
            def respond(engine,payload):
                if mode=='http': return 503, {}
                if mode=='json': return 200, b'INVALID SECRET RESPONSE'
                return 200, {'verdict':'accepted','findings':[],'extra':True}
            with self.subTest(mode=mode), fake_servers(respond) as (endpoints,requests), tempfile.TemporaryDirectory() as temp:
                root=Path(temp); gold=root/'gold.json'; output=root/'out'
                gold.write_text(json.dumps(gold_fixture()))
                completed=cli('--gold',gold,*endpoint_args(endpoints),'--output',output)
                self.assertNotEqual(completed.returncode,0)
                self.assertFalse(output.exists())
                self.assertNotIn('SECRET',completed.stderr)

    def test_transport_failure_raises_and_is_not_scored(self):
        with patch.object(runner,'open_http',side_effect=OSError('sensitive')):
            with self.assertRaisesRegex(ValueError,'TRANSPORT_ERROR'):
                runner.collect(gold_fixture()['cases'],{e:'http://127.0.0.1:1' for e in runner.ENGINES})


if __name__=='__main__': unittest.main()
