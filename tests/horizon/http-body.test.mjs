import { createServer } from 'node:http';
import { createHandler } from './create-test-app.mjs';
import { httpBodyTests } from '../contract/http-body-runtime.mjs';
httpBodyTests('horizon', record => createServer(createHandler({ ready: async () => true,
  prepare: text => ({ text }), infer: async ({ text }) => { record(text); return []; } })));
