import pLimit from "p-limit";

// State belongs exclusively to p-limit; the limiter and its queue stay private.
export function createAdmission(concurrency = 1) {
  if (!Number.isSafeInteger(concurrency) || concurrency <= 0)
    throw new TypeError("INVALID_CONCURRENCY");
  const limit = pLimit(concurrency);
  return {
    run<T>(task: () => Promise<T>): Promise<T> {
      // Reserve in the same synchronous turn: pending includes microtask reservations.
      if (limit.activeCount + limit.pendingCount >= concurrency)
        return Promise.reject(new Error("SATURATED"));
      return limit(task);
    },
  };
}
export type Admission = ReturnType<typeof createAdmission>;
