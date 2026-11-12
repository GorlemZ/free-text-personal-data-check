// Test-only native-output replacement, before the production semantic adapter.
import { createServer } from '../../poc-rizzo/src/app.mjs';
import { createDetector } from '../../poc-rizzo/src/detector.mjs';
import { semanticCategories } from '../../poc-rizzo/src/model.mjs';

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
const detect = await createDetector({modelFactory: async () => async text => semanticCategories(nativeOutput(text))});
const server = createServer({detect, ready: () => !unavailable});
server.listen(Number(process.env.PORT), '127.0.0.1');
for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, () => server.close(() => process.exit(0)));
