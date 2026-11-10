import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFunctionalDockerRunner } from '../functional/docker-runner.mjs';

const CID = 'a'.repeat(64);
const IMAGE = `sha256:${'b'.repeat(64)}`;
const NETWORK = 'poc-functional-aaaaaaaaaaaa';
const CONTAINER = 'poc-functional-aaaaaaaaaaaa-presidio';
function fakeDocker(overrides = {}) {
  const calls = [];
  let network = false;
  let container = false;
  let probe = false;
  const docker = (args, ignoreFailure = false) => {
    calls.push([...args]);
    if (overrides.call) {
      const value = overrides.call(args, { network, container, ignoreFailure });
      if (value !== undefined) return value;
    }
    if (args[0] === 'image') return IMAGE;
    if (args[0] === 'network' && args[1] === 'create') { network = true; return CID; }
    if (args[0] === 'network' && args[1] === 'inspect') return JSON.stringify({ Internal: true, Driver: 'bridge', Name: NETWORK });
    if (args[0] === 'network' && args[1] === 'rm') { network = false; return NETWORK; }
    if (args[0] === 'network' && args[1] === 'ls') return network ? NETWORK : '';
    if (args[0] === 'run' && args.includes(`${NETWORK}-probe`)) { probe = true; return 'EGRESS_DENIED'; }
    if (args[0] === 'run') { container = true; return CID; }
    if (args[0] === 'port') return '127.0.0.1:49153';
    if (args[0] === 'rm') { if (args.includes(`${NETWORK}-probe`)) probe = false; else container = false; return args.at(-1); }
    if (args[0] === 'ps') return args.some(x => x.includes('-probe')) ? (probe ? `${NETWORK}-probe` : '') : (container ? CONTAINER : '');
    throw new Error('unexpected Docker command');
  };
  return { docker, calls, state: () => ({ network, container }) };
}

test('Horizon preflight executes Node script with -e before service startup', async () => {
  const fake = fakeDocker();
  const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  await runner.withContainer('free-text-check:horizon-functional', 'horizon', async () => {});
  const probe = fake.calls.find(x => x[0] === 'run' && x.includes(`${NETWORK}-probe`));
  assert.equal(probe[probe.indexOf('--entrypoint') + 1], 'node');
  assert.equal(probe.at(-2), '-e');
});

test('egress timeout or unexpected output fails closed and removes probe/network', async () => {
  for (const output of ['EGRESS_UNPROVEN', 'EGRESS_OPEN', '', 'sensitive raw output']) {
    const fake = fakeDocker({ call: args => args[0] === 'run' && args.includes(`${NETWORK}-probe`) ? output : undefined });
    const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    await assert.rejects(runner.withContainer('image:tag', 'presidio', async () => {
      assert.fail('callback must not run');
    }), { message: 'DOCKER_EGRESS_UNPROVEN' });
    assert.ok(!fake.calls.some(x => x[0] === 'run' && x.includes(CONTAINER)));
    assert.deepEqual(fake.state(), { network: false, container: false });
  }
});

test('unverified network metadata fails before egress probe', async () => {
  const fake = fakeDocker({ call: args => args[0] === 'network' && args[1] === 'inspect' ? '{"Internal":false,"Driver":"bridge"}' : undefined });
  const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  await assert.rejects(runner.withContainer('image:tag', 'presidio', async () => {}),
    { message: 'DOCKER_NETWORK_NOT_INTERNAL' });
  assert.ok(!fake.calls.some(x => x[0] === 'run'));
  assert.deepEqual(fake.state(), { network: false, container: false });
});

test('startup error and callback rejection both remove owned resources', async () => {
  for (const startup of [true, false]) {
    const fake = fakeDocker({ call: args => startup && args[0] === 'port' ? '0.0.0.0:49153' : undefined });
    const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
    await assert.rejects(runner.withContainer('image:tag', 'presidio', async () => {
      throw new Error('CALLBACK_FAILURE');
    }), { message: startup ? 'DOCKER_PORT_NOT_LOOPBACK' : 'CALLBACK_FAILURE' });
    assert.deepEqual(fake.state(), { network: false, container: false });
  }
});

test('failed cleanup remains tracked and retryable without adopting other resources', async () => {
  let refuse = true;
  const fake = fakeDocker({ call: (args, state) => {
    if (refuse && args[0] === 'rm' && args.includes(CONTAINER)) return '';
    if (refuse && state.container && args[0] === 'ps' && args.some(x => x.includes(CONTAINER))) return CONTAINER;
  } });
  const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  await assert.rejects(runner.withContainer('image:tag', 'presidio', async () => {}),
    { message: 'DOCKER_CLEANUP_FAILED' });
  assert.ok(!fake.calls.some(x => x[0] === 'network' && x[1] === 'rm'));
  refuse = false;
  runner.cleanup();
  assert.deepEqual(fake.state(), { network: false, container: false });
});

test('SIGINT removes service before callback settles and aborts its signal', async () => {
  const signals = new EventEmitter();
  const fake = fakeDocker();
  const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', signalTarget: signals });
  await assert.rejects(runner.withContainer('image:tag', 'presidio', async ({ signal }) => {
    signals.emit('SIGINT');
    assert.equal(signal.aborted, true);
    assert.deepEqual(fake.state(), { network: false, container: false });
  }), { message: 'INTERRUPTED' });
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('one runner rejects a concurrent service without disrupting the active one', async () => {
  const fake = fakeDocker();
  const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  await runner.withContainer('image:tag', 'presidio', async () => {
    await assert.rejects(runner.withContainer('image:tag', 'horizon', async () => {}),
      { message: 'DOCKER_RUNNER_BUSY' });
    assert.deepEqual(fake.state(), { network: true, container: true });
  });
});

// Tracer bullet: no inference, but the lifecycle reaches the callback only after isolation.
test('creates an internal network, proves egress blocked, then publishes only loopback', async () => {
  const fake = fakeDocker();
  const runner = createFunctionalDockerRunner({ docker: fake.docker, uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa' });
  const observed = await runner.withContainer('free-text-check:spacy-functional', 'presidio', async endpoint => endpoint);
  assert.equal(observed.url, 'http://127.0.0.1:49153');
  assert.equal(observed.imageId, IMAGE);
  const commands = fake.calls;
  const networkCreate = commands.findIndex(x => x[0] === 'network' && x[1] === 'create');
  const preflight = commands.findIndex(x => x[0] === 'run' && x.includes(`${NETWORK}-probe`));
  const service = commands.findIndex(x => x[0] === 'run' && x.includes(CONTAINER));
  assert.ok(networkCreate >= 0 && networkCreate < preflight && preflight < service);
  assert.ok(commands[networkCreate].includes('--internal'));
  assert.ok(commands[preflight].includes(NETWORK));
  assert.ok(commands[preflight].includes('-e') || commands[preflight].includes('-c'));
  assert.equal(commands[preflight].at(-2), '-c'); // Python preflight for Presidio.
  assert.ok(commands[service].includes('--network') && commands[service].includes(NETWORK));
  for (const value of ['--memory=4g', '--memory-swap=4g', '--cpus=2', '127.0.0.1::8000',
    'HF_HUB_OFFLINE=1', 'TRANSFORMERS_OFFLINE=1', 'ANALYZER_BIND_HOST=0.0.0.0'])
    assert.ok(commands[service].some(x => x.includes(value)), value);
  assert.deepEqual(fake.state(), { network: false, container: false });
});
