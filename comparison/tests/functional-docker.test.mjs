import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createFunctionalDockerRunner } from '../functional/docker-runner.mjs';

const CID = 'a'.repeat(64);
const IMAGE = `sha256:${'b'.repeat(64)}`;
const TOKEN = 'aaaaaaaaaaaa';
const CONTAINER = `poc-functional-${TOKEN}-presidio`;
function fakeDocker(overrides = {}) {
  const calls = [];
  let container = false;
  let name = CONTAINER;
  const docker = (args, ignoreFailure = false) => {
    calls.push([...args]);
    if (overrides.call) {
      const value = overrides.call(args, { container, name, ignoreFailure });
      if (value !== undefined) return value;
    }
    if (args[0] === 'image') return IMAGE;
    if (args[0] === 'run') { container = true; name = args[args.indexOf('--name') + 1]; return CID; }
    if (args[0] === 'inspect') return JSON.stringify({ Id: CID, Name: '/' + name, Image: IMAGE,
      HostConfig: { NetworkMode: 'default' }, NetworkSettings: { Networks: { bridge: {} } } });
    if (args[0] === 'port') return '127.0.0.1:49153';
    if (args[0] === 'rm') { container = false; return args.at(-1); }
    if (args[0] === 'ps') return container ? (args.includes('{{.Names}}') ? name : CID) : '';
    throw new Error('unexpected Docker command: ' + args.join(' '));
  };
  return { docker, calls, state: () => ({ container }) };
}
const runnerFor = (fake, options = {}) => createFunctionalDockerRunner({ docker: fake.docker,
  uuid: () => 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa', ...options });

test('runs one inspected immutable image without pull, build, egress probes or resource limits', async () => {
  const fake = fakeDocker();
  const observed = await runnerFor(fake).withContainer('local:tag', 'presidio', async endpoint => endpoint);
  assert.equal(observed.url, 'http://127.0.0.1:49153');
  assert.equal(observed.imageId, IMAGE);
  assert.deepEqual(observed.network, { mode: 'default', names: ['bridge'] });
  assert.equal(observed.bind, '127.0.0.1');
  const runs = fake.calls.filter(x => x[0] === 'run');
  assert.equal(runs.length, 1);
  assert.equal(runs[0].at(-1), IMAGE);
  assert.equal(runs[0][runs[0].indexOf('--pull') + 1], 'never');
  for (const value of ['127.0.0.1::8000', 'HF_HUB_OFFLINE=1', 'TRANSFORMERS_OFFLINE=1', 'ANALYZER_BIND_HOST=0.0.0.0'])
    assert.ok(runs[0].includes(value), value);
  assert.ok(!fake.calls.some(x => ['build', 'pull', 'network', 'exec'].includes(x[0])));
  assert.ok(!runs[0].some(x => /^--(?:network|memory|cpus)/.test(x)));
  assert.ok(fake.calls.some(x => x[0] === 'inspect' && x.includes(CID)));
  assert.ok(fake.calls.some(x => x[0] === 'rm' && x.at(-1) === CID));
  assert.deepEqual(fake.state(), { container: false });
});

test('interruption before startup never creates a service', async () => {
  const signals = new EventEmitter();
  const fake = fakeDocker({ call: args => { if (args[0] === 'image') signals.emit('SIGTERM'); } });
  await assert.rejects(runnerFor(fake, { signalTarget: signals }).withContainer('local:tag', 'presidio',
    async () => assert.fail('callback must not run')), { message: 'INTERRUPTED' });
  assert.ok(!fake.calls.some(args => args[0] === 'run'));
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('verifies the actual container image before exposing an endpoint', async () => {
  const fake = fakeDocker({ call: args => args[0] === 'inspect' ? JSON.stringify({
    Id: CID, Name: '/' + CONTAINER, Image: `sha256:${'c'.repeat(64)}` }) : undefined });
  await assert.rejects(runnerFor(fake).withContainer('local:tag', 'presidio',
    async () => assert.fail('callback must not run')), { message: 'DOCKER_IMAGE_ID_MISMATCH' });
  assert.deepEqual(fake.state(), { container: false });
});

test('startup errors and callback rejection both remove only the owned container ID', async () => {
  for (const startup of [true, false]) {
    const fake = fakeDocker({ call: args => startup && args[0] === 'port' ? '0.0.0.0:49153' : undefined });
    await assert.rejects(runnerFor(fake).withContainer('local:tag', 'presidio', async () => {
      throw new Error('CALLBACK_FAILURE');
    }), { message: startup ? 'DOCKER_PORT_NOT_LOOPBACK' : 'CALLBACK_FAILURE' });
    assert.deepEqual(fake.state(), { container: false });
    assert.deepEqual(fake.calls.filter(args => args[0] === 'rm'), [['rm', '-f', CID]]);
  }
});

test('a colliding name is never adopted or removed', async () => {
  const fake = fakeDocker({ call: args => args[0] === 'ps' ? CONTAINER : undefined });
  await assert.rejects(runnerFor(fake).withContainer('local:tag', 'presidio', async () => {}),
    { message: 'DOCKER_NAME_COLLISION' });
  assert.ok(!fake.calls.some(args => ['run', 'rm'].includes(args[0])));
});

test('failed startup recovers only labelled containers without exposing command output', async () => {
  const fake = fakeDocker({ call: args => {
    if (args[0] === 'run') throw new Error('PRIVATE_DOCKER_OUTPUT');
    if (args[0] === 'ps' && args.some(x => x.startsWith('label='))) return CID;
  } });
  await assert.rejects(runnerFor(fake).withContainer('local:tag', 'presidio', async () => {}),
    { message: 'DOCKER_COMMAND_FAILED' });
  assert.ok(fake.calls.some(args => args.includes(`label=poc.functional.run=${TOKEN}`)));
  assert.deepEqual(fake.calls.filter(args => args[0] === 'rm'), [['rm', '-f', CID]]);
});

test('failed cleanup stays tracked and blocks reuse until a successful retry', async () => {
  let refuse = true;
  const fake = fakeDocker({ call: args => refuse && args[0] === 'rm' ? '' : undefined });
  const runner = runnerFor(fake);
  await assert.rejects(runner.withContainer('local:tag', 'presidio', async () => {}),
    { message: 'DOCKER_CLEANUP_FAILED' });
  await assert.rejects(runner.withContainer('local:tag', 'horizon', async () => {}),
    { message: 'DOCKER_RUNNER_BUSY' });
  refuse = false;
  runner.cleanup();
  assert.deepEqual(fake.state(), { container: false });
});

for (const signalName of ['SIGINT', 'SIGTERM']) test(`${signalName} aborts HTTP and cleans up before callback settles`, async () => {
  const signals = new EventEmitter();
  const fake = fakeDocker();
  await assert.rejects(runnerFor(fake, { signalTarget: signals }).withContainer('local:tag', 'presidio',
    async ({ signal }) => {
      signals.emit(signalName);
      assert.equal(signal.aborted, true);
      assert.deepEqual(fake.state(), { container: false });
    }), { message: 'INTERRUPTED' });
  assert.equal(signals.listenerCount('SIGINT'), 0);
  assert.equal(signals.listenerCount('SIGTERM'), 0);
});

test('one runner rejects a concurrent service without disrupting its active container', async () => {
  const fake = fakeDocker();
  const runner = runnerFor(fake);
  await runner.withContainer('local:tag', 'presidio', async () => {
    await assert.rejects(runner.withContainer('local:tag', 'horizon', async () => {}),
      { message: 'DOCKER_RUNNER_BUSY' });
    assert.deepEqual(fake.state(), { container: true });
  });
});
