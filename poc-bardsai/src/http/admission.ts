type QueueEntry = Readonly<{
  task: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}>;

class AdmissionQueue {
  readonly #concurrency: number;
  readonly #maxPendingRequests: number;
  readonly #maxQueueWaitMs: number;
  #active = 0;
  readonly #pending: QueueEntry[] = [];

  constructor(
    concurrency: number,
    maxPendingRequests: number,
    maxQueueWaitMs: number,
  ) {
    this.#concurrency = concurrency;
    this.#maxPendingRequests = maxPendingRequests;
    this.#maxQueueWaitMs = maxQueueWaitMs;
  }

  run<T>(task: () => Promise<T>): Promise<T> {
    if (this.#active < this.#concurrency) return this.#execute(task);
    if (this.#pending.length >= this.#maxPendingRequests)
      return Promise.reject(new Error("SATURATED"));

    return new Promise<T>((resolve, reject) => {
      const entry: QueueEntry = {
        task,
        resolve: (value) => resolve(value as T),
        reject,
        timer: setTimeout(() => this.#expire(entry), this.#maxQueueWaitMs),
      };
      this.#pending.push(entry);
    });
  }

  #execute<T>(task: () => Promise<T>): Promise<T> {
    this.#active += 1;
    return Promise.resolve()
      .then(task)
      .finally(() => this.#release());
  }

  #release(): void {
    this.#active -= 1;
    const entry = this.#pending.shift();
    if (entry === undefined) return;
    clearTimeout(entry.timer);
    void this.#execute(entry.task).then(entry.resolve, entry.reject);
  }

  #expire(entry: QueueEntry): void {
    const index = this.#pending.indexOf(entry);
    if (index < 0) return;
    this.#pending.splice(index, 1);
    entry.reject(new Error("QUEUE_TIMEOUT"));
  }
}

export function createAdmission(
  concurrency = 1,
  maxPendingRequests = 4,
  maxQueueWaitMs = 500,
): AdmissionQueue {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0)
    throw new TypeError("INVALID_CONCURRENCY");
  if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 0)
    throw new TypeError("INVALID_MAX_PENDING_REQUESTS");
  if (!Number.isSafeInteger(maxQueueWaitMs) || maxQueueWaitMs <= 0)
    throw new TypeError("INVALID_MAX_QUEUE_WAIT_MS");
  return new AdmissionQueue(concurrency, maxPendingRequests, maxQueueWaitMs);
}

export type Admission = ReturnType<typeof createAdmission>;
