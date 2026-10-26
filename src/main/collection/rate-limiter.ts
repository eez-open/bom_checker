import { QuotaExceededError } from "../suppliers/types";
import { realClock, type Clock } from "./clock";

export interface RateLimits {
    /** Minimum time between two requests. */
    minIntervalMs: number;
    /** 0 means no limit. */
    perMinute: number;
    /** 0 means no limit. */
    perDay: number;
}

/** Requests sent today; kept across runs and app restarts. */
export interface DailyCounter {
    used(): number;
    add(count: number): void;
}

const MINUTE = 60_000;

/**
 * Spaces out the requests of one supplier. A run sends one request at a
 * time, so `acquire` is never called concurrently.
 */
export class RateLimiter {
    private last = Number.NEGATIVE_INFINITY;
    private recent: number[] = [];

    constructor(
        private readonly limits: RateLimits,
        private readonly counter: DailyCounter,
        private readonly clock: Clock = realClock
    ) {}

    /** Waits until a request may be sent and counts it. Throws
     *  QuotaExceededError when today's limit is used up. */
    async acquire(signal?: AbortSignal): Promise<void> {
        const { minIntervalMs, perMinute, perDay } = this.limits;
        if (perDay > 0 && this.counter.used() >= perDay) {
            throw new QuotaExceededError(
                `The daily limit of ${perDay} requests is reached.`
            );
        }
        for (;;) {
            const now = this.clock.now();
            this.recent = this.recent.filter(time => time > now - MINUTE);
            const waitForInterval = this.last + minIntervalMs - now;
            const waitForMinute =
                perMinute > 0 && this.recent.length >= perMinute
                    ? this.recent[0]! + MINUTE - now
                    : 0;
            const wait = Math.max(waitForInterval, waitForMinute);
            if (wait <= 0) {
                this.last = now;
                this.recent.push(now);
                this.counter.add(1);
                return;
            }
            await this.clock.sleep(wait, signal);
        }
    }

    /** Requests left today, or null without a daily limit. */
    remainingToday(): number | null {
        const { perDay } = this.limits;
        return perDay > 0 ? Math.max(0, perDay - this.counter.used()) : null;
    }
}
