declare class AdmissionQueue {
    #private;
    constructor(concurrency: number, maxPendingRequests: number, maxQueueWaitMs: number);
    run<T>(task: () => Promise<T>): Promise<T>;
}
export declare function createAdmission(concurrency?: number, maxPendingRequests?: number, maxQueueWaitMs?: number): AdmissionQueue;
export type Admission = ReturnType<typeof createAdmission>;
export {};
