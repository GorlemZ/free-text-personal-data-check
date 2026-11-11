// Test process only. Real CLI, collector, validation and lifecycle; fake Docker transport.
import { registerHooks } from 'node:module';
import { readFileSync } from 'node:fs';
const settings = JSON.parse(readFileSync(process.env.COMPARISON_FAKE_CONFIG, 'utf8'));
const marker = '?test-original';
const header = `import { appendFileSync } from 'node:fs';
  const settings = ${JSON.stringify(settings)};
  const event = text => appendFileSync(settings.events, text + '\\n');`;
registerHooks({ load(url, context, nextLoad) {
  if (url.endsWith('/functional/load-corpus.mjs')) return { format: 'module', shortCircuit: true, source: `
    ${header}
    export * from ${JSON.stringify(url + marker)};
    import { loadCorpus as original } from ${JSON.stringify(url + marker)};
    export async function loadCorpus() {
      if (settings.noInputReads) throw new Error('UNEXPECTED_GOLD_READ');
      event('gold:load');
      const p = await original();
      return { ...p, review: { status: settings.reviewStatus, reviewer: 'FAKE TEST ONLY' } };
    }
  ` };
  if (url.endsWith('/functional/config.mjs')) return { format: 'module', shortCircuit: true, source: `
    ${header}
    export * from ${JSON.stringify(url + marker)};
    import { loadCapabilities as original } from ${JSON.stringify(url + marker)};
    export async function loadCapabilities() {
      if (settings.noInputReads) throw new Error('UNEXPECTED_CAPABILITY_READ');
      return original();
    }
    export async function countHorizonTokens() {
      if (settings.noInputReads) throw new Error('UNEXPECTED_TOKENIZER_READ');
      return 8;
    }
  ` };
  if (url.endsWith('/functional/collect.mjs')) return { format: 'module', shortCircuit: true, source: `
    ${header}
    export * from ${JSON.stringify(url + marker)};
    import { collectEngine as original } from ${JSON.stringify(url + marker)};
    export async function collectEngine(...args) {
      event(args[0] + ':collect');
      return original(...args.slice(0, 6), settings.timeoutMs ?? 30000);
    }
  ` };
  if (url.endsWith('/functional/docker-runner.mjs')) return { format: 'module', shortCircuit: true, source: `
    ${header}
    import { createFunctionalDockerRunner as original } from ${JSON.stringify(url + marker)};
    const containers = new Map();
    export function dockerCommand() { throw new Error('REAL_DOCKER_FORBIDDEN_IN_TEST'); }
    export function createFunctionalDockerRunner() {
      if (settings.noInputReads) throw new Error('UNEXPECTED_DOCKER');
      return original({ docker: args => {
        appendFileSync(settings.commands, JSON.stringify(args) + '\\n');
        if (args[0] === 'image') {
          if (settings.mode === 'startup-failed') throw new Error('SENTINEL_RAW_FAILURE');
          return settings.imageIds[args[2] === 'fake:p' ? 'presidio' : 'horizon'];
        }
        if (args[0] === 'run') {
          const engine = Object.keys(settings.imageIds).find(n => settings.imageIds[n] === args.at(-1));
          if (!engine) throw new Error('MUTABLE_TAG_RUN');
          const id = (engine === 'presidio' ? 'c' : 'd').repeat(64);
          containers.set(id, { engine, name: args[args.indexOf('--name') + 1], image: args.at(-1) });
          event(engine + ':start');
          return id;
        }
        if (args[0] === 'inspect') {
          const c = containers.get(args[1]);
          return JSON.stringify({ Id: args[1], Name: '/' + c.name, Image: c.image,
            HostConfig: { NetworkMode: 'default' }, NetworkSettings: { Networks: { bridge: {} } } });
        }
        if (args[0] === 'port') return new URL(settings.urls[containers.get(args[1]).engine]).host;
        if (args[0] === 'rm') {
          const c = containers.get(args.at(-1));
          if (c) event(c.engine + ':stop');
          containers.delete(args.at(-1));
          return args.at(-1);
        }
        if (args[0] === 'ps') {
          const id = args.find(x => x.startsWith('id='))?.slice(3);
          if (id) return containers.has(id) ? id : '';
          const name = args.find(x => x.startsWith('name=^/'))?.slice(7, -1);
          const entry = [...containers].find(([, c]) => c.name === name);
          return entry ? (args.includes('{{.Names}}') ? entry[1].name : entry[0]) : '';
        }
        throw new Error('UNEXPECTED_DOCKER_COMMAND');
      } });
    }
  ` };
  return nextLoad(url, context);
} });
