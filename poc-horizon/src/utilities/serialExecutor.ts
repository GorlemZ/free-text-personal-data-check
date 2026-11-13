import { HTTP_LIMITS } from '../config/config.js';
import { DetectorUnavailable } from '../model/errors.js';

export type SerialExecutor = ReturnType<typeof createSerialExecutor>;
export function createSerialExecutor(onQueued?: (pending: number) => void) {
  let pending = 0;
  let tail: Promise<unknown> = Promise.resolve();
  return {
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (pending >= HTTP_LIMITS.maxPending) throw new DetectorUnavailable();
      pending++;
      const job = tail.then(task);
      tail = job.catch(() => {});
      try {
        onQueued?.(pending); // Test-only numeric observer, no request data.
        return await job;
      } finally { pending--; }
    },
  };
}
