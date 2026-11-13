// Test-only native-output replacement, before the production semantic adapter.
import { createServer } from 'node:http';
import { createApp } from '../../poc-rizzo/dist/app.js';
import { analysisServiceBuilder } from '../../poc-rizzo/dist/services/analysisService.js';
import { modelDetectionServiceBuilder } from '../../poc-rizzo/dist/services/modelDetectionService.js';
import { ruleDetectionServiceBuilder } from '../../poc-rizzo/dist/services/ruleDetectionService.js';

const unavailable = process.env.CONTRACT_UNAVAILABLE === '1';
const entity = label => ({label, text:'synthetic fixture', score:.99});
function nativeOutput(text) {
  if (unavailable || text === 'fixture:throw') throw new Error('fixture unavailable');
  const person = entity('FULLNAME');
  const extra = entity('CITY');
  switch (text) {
    case 'fixture:extra': return [extra];
    case 'fixture:person': return [person];
    case 'fixture:extra-person': return [extra, person];
    case 'fixture:person-aliases': return [person, person];
    case 'fixture:unknown': return [entity('NATIVE_UNRECOGNIZED')];
    case 'fixture:malformed': return [{...person, score:NaN}];
    case 'fixture:phone 3331234567': return [{label:'TELEPHONENUM', text:'3331234567',score:.99}];
    default: return [];
  }
}
const modelDetectionService = modelDetectionServiceBuilder({ infer: async text => ({ output: nativeOutput(text).map(({ label, text: word, score }) => ({ entity_group: label, word, score })) }) });
const analysisService = analysisServiceBuilder({ modelDetectionService, ruleDetectionService: ruleDetectionServiceBuilder() });
const server = createServer(createApp({ analysisService, ready: () => !unavailable }));
server.listen(Number(process.env.PORT), '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
