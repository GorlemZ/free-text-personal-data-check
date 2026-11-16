class AdmissionQueue {
    #concurrency;
    #maxPendingRequests;
    #maxQueueWaitMs;
    #active = 0;
    #pending = [];
    constructor(concurrency, maxPendingRequests, maxQueueWaitMs) {
        this.#concurrency = concurrency;
        this.#maxPendingRequests = maxPendingRequests;
        this.#maxQueueWaitMs = maxQueueWaitMs;
    }
    run(task) {
        if (this.#active < this.#concurrency)
            return this.#execute(task);
        if (this.#pending.length >= this.#maxPendingRequests)
            return Promise.reject(new Error("SATURATED"));
        return new Promise((resolve, reject) => {
            const entry = {
                task,
                resolve: (value) => resolve(value),
                reject,
                timer: setTimeout(() => this.#expire(entry), this.#maxQueueWaitMs),
            };
            this.#pending.push(entry);
        });
    }
    #execute(task) {
        this.#active += 1;
        return Promise.resolve()
            .then(task)
            .finally(() => this.#release());
    }
    #release() {
        this.#active -= 1;
        const entry = this.#pending.shift();
        if (entry === undefined)
            return;
        clearTimeout(entry.timer);
        void this.#execute(entry.task).then(entry.resolve, entry.reject);
    }
    #expire(entry) {
        const index = this.#pending.indexOf(entry);
        if (index < 0)
            return;
        this.#pending.splice(index, 1);
        entry.reject(new Error("QUEUE_TIMEOUT"));
    }
}
export function createAdmission(concurrency = 1, maxPendingRequests = 4, maxQueueWaitMs = 500) {
    if (!Number.isSafeInteger(concurrency) || concurrency <= 0)
        throw new TypeError("INVALID_CONCURRENCY");
    if (!Number.isSafeInteger(maxPendingRequests) || maxPendingRequests < 0)
        throw new TypeError("INVALID_MAX_PENDING_REQUESTS");
    if (!Number.isSafeInteger(maxQueueWaitMs) || maxQueueWaitMs <= 0)
        throw new TypeError("INVALID_MAX_QUEUE_WAIT_MS");
    return new AdmissionQueue(concurrency, maxPendingRequests, maxQueueWaitMs);
}
