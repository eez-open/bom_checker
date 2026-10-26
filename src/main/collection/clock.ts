import { setTimeout as delay } from "node:timers/promises";

/** Time source, replaceable in tests. */
export interface Clock {
    now(): number;
    /** Rejects with an AbortError when `signal` is aborted. */
    sleep(ms: number, signal?: AbortSignal): Promise<void>;
}

export const realClock: Clock = {
    now: () => Date.now(),
    sleep: async (ms, signal) => {
        if (ms > 0) {
            await delay(ms, undefined, { signal });
        }
    }
};
