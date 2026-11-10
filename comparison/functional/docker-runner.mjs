// Isolated, one-at-a-time lifecycle. Never expose Docker output or exception text.
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

export function dockerCommand(args, ignoreFailure = false) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 180000,
    stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1024 * 1024 });
  if ((result.error || result.status !== 0) && !ignoreFailure) throw new Error('DOCKER_COMMAND_FAILED');
  return result.stdout?.trim() ?? '';
}

// A positive sentinel is only emitted for a kernel route-denial. Timeouts, connection
// refusals and DNS failures are NOT evidence of network isolation.
const probeNode = `const s=require('node:net').connect({host:'1.1.1.1',port:443,timeout:2500});
s.on('connect',()=>{console.log('EGRESS_OPEN');s.destroy()});
s.on('timeout',()=>{console.log('EGRESS_UNPROVEN');s.destroy()});
s.on('error',e=>console.log(['ENETUNREACH','EHOSTUNREACH'].includes(e.code)?'EGRESS_DENIED':'EGRESS_UNPROVEN'));`;
const probePython = `import socket,errno\ns=socket.socket();s.settimeout(2.5)\ntry:\n s.connect(('1.1.1.1',443));print('EGRESS_OPEN')\nexcept OSError as e:\n print('EGRESS_DENIED' if e.errno in (errno.ENETUNREACH,errno.EHOSTUNREACH) else 'EGRESS_UNPROVEN')\nfinally:\n s.close()`;

export function createFunctionalDockerRunner({ docker = dockerCommand, uuid = randomUUID,
  signalTarget = process } = {}) {
  const token = uuid().replaceAll('-', '').slice(0, 12);
  if (!/^[a-f0-9]{12}$/.test(token)) throw new Error('DOCKER_NAME_INVALID');
  const network = `poc-functional-${token}`;
  const pending = new Set();
  let networkPending = false;
  let busy = false;
  const command = (args, ignoreFailure = false) => {
    try { return docker(args, ignoreFailure); }
    catch { throw new Error('DOCKER_COMMAND_FAILED'); }
  };
  function cleanup() {
    let failed = false;
    for (const name of [...pending]) {
      try {
        command(['rm', '-f', name], true);
        if (command(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])
          .split(/\r?\n/).includes(name)) throw new Error('DOCKER_CLEANUP_FAILED');
        pending.delete(name);
      } catch { failed = true; }
    }
    if (networkPending && pending.size === 0) {
      try {
        command(['network', 'rm', network], true);
        if (command(['network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}'])
          .split(/\r?\n/).includes(network)) throw new Error('DOCKER_CLEANUP_FAILED');
        networkPending = false;
      } catch { failed = true; }
    }
    if (failed) throw new Error('DOCKER_CLEANUP_FAILED');
  }
  async function withContainer(image, engine, callback) {
    if (busy || networkPending || pending.size) throw new Error('DOCKER_RUNNER_BUSY');
    if (!['presidio', 'horizon'].includes(engine) ||
        !/^[a-zA-Z0-9][a-zA-Z0-9._:/@-]*$/.test(image) ||
        typeof callback !== 'function') throw new Error('DOCKER_INPUT_INVALID');
    busy = true;
    const controller = new AbortController();
    const onSignal = signal => {
      controller.abort();
      try { cleanup(); } catch { process.exitCode = 1; }
      if (signalTarget === process) process.exitCode ||= signal === 'SIGINT' ? 130 : 143;
    };
    const int = () => onSignal('SIGINT');
    const term = () => onSignal('SIGTERM');
    signalTarget.on('SIGINT', int);
    signalTarget.on('SIGTERM', term);
    try {
      const imageId = command(['image', 'inspect', image, '--format', '{{.Id}}']);
      if (!/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error('DOCKER_IMAGE_ID_INVALID');
      // Never adopt an existing network, even if the random name happens to collide.
      if (command(['network', 'ls', '--filter', `name=^${network}$`, '--format', '{{.Name}}']))
        throw new Error('DOCKER_NAME_COLLISION');
      networkPending = true; // Creation can succeed even when the client reports failure.
      if (!/^[a-f0-9]{64}$/.test(command(['network', 'create', '--driver', 'bridge', '--internal', network])))
        throw new Error('DOCKER_NETWORK_INVALID');
      const details = JSON.parse(command(['network', 'inspect', network, '--format', '{{json .}}']));
      const actual = Array.isArray(details) ? details[0] : details;
      if (actual?.Internal !== true || actual?.Driver !== 'bridge' ||
          (actual?.Name && actual.Name !== network)) throw new Error('DOCKER_NETWORK_NOT_INTERNAL');
      const probe = `${network}-probe`;
      pending.add(probe);
      const executable = engine === 'presidio' ? 'python' : 'node';
      const script = engine === 'presidio' ? probePython : probeNode;
      const result = command(['run', '--name', probe, '--network', network,
        '--entrypoint', executable, image, engine === 'presidio' ? '-c' : '-e', script]);
      if (result !== 'EGRESS_DENIED') throw new Error('DOCKER_EGRESS_UNPROVEN');
      // Keep a failed probe tracked; only proceed once removal is confirmed.
      cleanupProbe();
      const name = `${network}-${engine}`;
      if (command(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}']))
        throw new Error('DOCKER_NAME_COLLISION');
      pending.add(name);
      const id = command(['run', '-d', '--name', name, '--network', network,
        '--memory=4g', '--memory-swap=4g', '--cpus=2',
        '-e', 'ANALYZER_BIND_HOST=0.0.0.0', '-e', 'HF_HUB_OFFLINE=1',
        '-e', 'TRANSFORMERS_OFFLINE=1', '-p', '127.0.0.1::8000', image]);
      if (!/^[a-f0-9]{64}$/.test(id)) throw new Error('DOCKER_CONTAINER_ID_INVALID');
      const ports = command(['port', id, '8000/tcp']);
      const match = /^127\.0\.0\.1:(\d+)$/.exec(ports);
      if (!match || Number(match[1]) < 1 || Number(match[1]) > 65535)
        throw new Error('DOCKER_PORT_NOT_LOOPBACK');
      if (controller.signal.aborted) throw new Error('INTERRUPTED');
      const value = await callback({ name, url: `http://127.0.0.1:${match[1]}`,
        imageId, signal: controller.signal });
      if (controller.signal.aborted) throw new Error('INTERRUPTED');
      return value;
    } finally {
      signalTarget.off('SIGINT', int);
      signalTarget.off('SIGTERM', term);
      try { cleanup(); } finally { busy = false; }
    }
  }
  function cleanupProbe() {
    const name = `${network}-probe`;
    command(['rm', '-f', name], true);
    if (command(['ps', '-a', '--filter', `name=^/${name}$`, '--format', '{{.Names}}'])
      .split(/\r?\n/).includes(name)) throw new Error('DOCKER_CLEANUP_FAILED');
    pending.delete(name);
  }
  return { withContainer, cleanup };
}
