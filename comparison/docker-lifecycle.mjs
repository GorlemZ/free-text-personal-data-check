// Keep container names until their removal can be confirmed by Docker.
export class ContainerTracker {
  constructor(docker) {
    this.docker = docker;
    this.active = new Set();
  }
  track(name) {
    if (!/^poc-comparison-[a-f0-9-]{8,}$/.test(name))
      throw new Error('DOCKER_CONTAINER_NAME_INVALID');
    this.active.add(name);
  }
  stop(name) {
    if (!name || !this.active.has(name)) return;
    try {
      this.docker(['rm', '-f', name], true); // --rm may have removed an exited container.
      const listed = this.docker(['ps', '-a', '--filter', `name=^/${name}$`,
        '--format', '{{.Names}}']);
      if (listed.split(/\r?\n/).includes(name)) throw new Error('DOCKER_CLEANUP_FAILED');
      this.active.delete(name);
    } catch { throw new Error('DOCKER_CLEANUP_FAILED'); }
  }
  stopAll() {
    let failed = false;
    for (const name of [...this.active]) {
      try { this.stop(name); } catch { failed = true; }
    }
    if (failed) throw new Error('DOCKER_CLEANUP_FAILED');
  }
}
