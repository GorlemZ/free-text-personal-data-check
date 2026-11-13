// Contract-only fixture entrypoint; production never imports these native stubs.
import { createServer } from 'node:http';
import { createHandler } from '../horizon/create-test-app.mjs';

const unavailable = process.env.CONTRACT_UNAVAILABLE === '1';
const native = entity_group => ({ entity_group, score: 0.9 });
const server = createServer(createHandler({
  prepare: text => ({ text }),
  ready: async () => { if (unavailable) throw Error('fixture unavailable'); },
  infer: async ({ text }) => {
    if (unavailable || text === 'fixture:throw') throw Error('fixture unavailable');
    switch (text) {
      case 'fixture:extra': return [native('LOCATION')];
      case 'fixture:person': return [native('PERSON')];
      case 'fixture:extra-person': return [native('LOCATION'), native('PERSON')];
      case 'fixture:person-aliases': return [native('PERSON'), native('PERSON')];
      case 'fixture:unknown': return [native('NATIVE_UNRECOGNIZED')];
      case 'fixture:malformed': return [{ entity_group: 'PERSON', score: 'bad' }];
      case 'fixture:phone 3331234567': return [{ ...native('PHONE'),
        start: text.indexOf('3331234567'), end: text.length }];
      default: return [];
    }
  },
}));
server.listen(Number(process.env.PORT ?? 0), '127.0.0.1', () => {
  console.log(JSON.stringify({ port: server.address().port }));
});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
  server.closeAllConnections();
  server.close();
});
