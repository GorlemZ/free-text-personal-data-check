// One service at a time on Docker's default bridge; loopback is not egress isolation.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function dockerCommand(args, ignoreFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  if ((result.error || result.status !== 0) && !ignoreFailure) throw new Error('DOCKER_COMMAND_FAILED');
  return result.stdout?.trim() ?? '';
}

export function createFunctionalDockerRunner({ docker = dockerCommand, uuid = randomUUID,
  signalTarget = process } = {}) {
  const token = uuid().replaceAll('-', '').slice(0, 12);
  if (!/^[a-f0-9]{12}$/.test(token)) throw new Error('DOCKER_NAME_INVALID');
  const label = `poc.functional.run=${token}`;
  const pending = new Map();
  let busy = false;
  const command = (args, ignoreFailure = false) => {
    try { return docker(args, ignoreFailure); }
    catch { throw new Error('DOCKER_COMMAND_FAILED'); }
  };
  function cleanup() {
    let failed = false;
    for (const [name, knownId] of pending) {
      try {
        // A failed client can still have created a container. Recover only our labelled ID.
        const id = knownId ?? command(['ps', '-a', '--no-trunc', '--filter', `name=^/${name}$`,
          '--filter', `label=${label}`, '--format', '{{.ID}}']);
        if (id) {
          if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('DOCKER_CLEANUP_FAILED');
          pending.set(name, id);
          command(['rm', '-f', id], true);
          if (command(['ps', '-a', '--no-trunc', '--filter', `id=${id}`, '--format', '{{.ID}}']))
            throw new Error('DOCKER_CLEANUP_FAILED');
        }
        pending.delete(name);
      } catch { failed = true; }
    }
    if (failed) throw new Error('DOCKER_CLEANUP_FAILED');
  }
  async function withContainer(image, engine, callback) {
    if (busy || pending.size) throw new Error('DOCKER_RUNNER_BUSY');
    if (!['presidio', 'horizon'].includes(engine) || typeof image !== 'string' ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(image) ||
        typeof callback !== 'function') throw new Error('DOCKER_INPUT_INVALID');
    busy = true;
    const controller = new AbortController();
    const onSignal = signal => {
      controller.abort();
      try { cleanup(); } catch { if (signalTarget === process) process.exitCode ||= 1; }
      if (signalTarget === process) process.exitCode ||= signal === 'SIGINT' ? 130 : 143;
    };
    const int = () => onSignal('SIGINT');
    const term = () => onSignal('SIGTERM');
    signalTarget.on('SIGINT', int);
    signalTarget.on('SIGTERM', term);
    try {
      // Inspect local images only. Builds are explicit and a mutable tag is never run.
      const imageId = command(['image', 'inspect', image, '--format', '{{.Id}}']);
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('DOCKER_IMAGE_ID_INVALID');
      const name = `poc-functional-${token}-${engine}`;
      if (command(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']))
        throw new Error('DOCKER_NAME_COLLISION');
      if (controller.signal.aborted) throw new Error('INTERRUPTED');
      pending.set(name, null);
      const id = command(['run', '-d', '--pull', 'never', '--name', name, '--label', label,
        '-e', 'ANALYZER_BIND_HOST=0.0.0.0', '-e', 'HF_HUB_OFFLINE=1',
        '-e', 'TRANSFORMERS_OFFLINE=1', '-p', '127.0.0.1::8000', imageId]);
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('DOCKER_CONTAINER_ID_INVALID');
      pending.set(name, id);
      let actual;
      try { actual = JSON.parse(command(['inspect', id, '--format', '{{json .}}'])); }
      catch { throw new Error('DOCKER_INSPECT_FAILED'); }
      if (actual?.Id !== id || actual?.Image !== imageId || actual?.Name !== `/${name}`)
        throw new Error('DOCKER_IMAGE_ID_MISMATCH');
      const mode = actual.HostConfig?.NetworkMode;
      const names = Object.keys(actual.NetworkSettings?.Networks ?? {}).sort();
      if (typeof mode !== 'string' || !/^[a-zA-Z0-9_.-]+$/.test(mode) ||
          !names.length || names.some(n => !/^[a-zA-Z0-9_.-]+$/.test(n)))
        throw new Error('DOCKER_NETWORK_INVALID');
      const ports = command(['port', id, '8000/tcp']);
      const match = /^127\.0\.0\.1:([1-9][0-9]{0,4})$/.exec(ports);
      if (!match || Number(match[1]) > 65535) throw new Error('DOCKER_PORT_NOT_LOOPBACK');
      if (controller.signal.aborted) throw new Error('INTERRUPTED');
      const value = await callback({ name, url: `http://127.0.0.1:${match[1]}`,
        imageId: actual.Image, network: { mode, names }, bind: '127.0.0.1', signal: controller.signal });
      if (controller.signal.aborted) throw new Error('INTERRUPTED');
      return value;
    } finally {
      signalTarget.off('SIGINT', int);
      signalTarget.off('SIGTERM', term);
      try { cleanup(); } finally { busy = false; }
    }
  }
  return { withContainer, cleanup };
}
