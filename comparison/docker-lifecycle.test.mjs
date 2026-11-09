import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ContainerTracker } from './docker-lifecycle.mjs';

test('tracks name before docker run returns and confirms disappearance after cleanup', () => {
  const calls = [];
  const tracker = new ContainerTracker((args) => { calls.push(args); return ''; });
  tracker.track('poc-comparison-aaaaaaaa');
  assert.deepEqual([...tracker.active], ['poc-comparison-aaaaaaaa']);
  tracker.stop('poc-comparison-aaaaaaaa');
  assert.deepEqual([...tracker.active], []);
  assert.deepEqual(calls.map(args => args[0]), ['rm', 'ps']);
});

test('failed removal or unverifiable Docker state is not reported as successful cleanup', () => {
  let present = true;
  const tracker = new ContainerTracker(args => {
    if (args[0] === 'ps') return present ? 'poc-comparison-aaaaaaaa' : '';
    return '';
  });
  tracker.track('poc-comparison-aaaaaaaa');
  assert.throws(() => tracker.stop('poc-comparison-aaaaaaaa'), { message: 'DOCKER_CLEANUP_FAILED' });
  assert.deepEqual([...tracker.active], ['poc-comparison-aaaaaaaa']);
  present = false;
  tracker.stopAll();
  assert.deepEqual([...tracker.active], []);

  const unavailable = new ContainerTracker(args => {
    if (args[0] === 'ps') throw new Error('simulated daemon unavailable');
    return '';
  });
  unavailable.track('poc-comparison-aaaaaaaa');
  assert.throws(() => unavailable.stopAll(), { message: 'DOCKER_CLEANUP_FAILED' });
  assert.deepEqual([...unavailable.active], ['poc-comparison-aaaaaaaa']);
});
