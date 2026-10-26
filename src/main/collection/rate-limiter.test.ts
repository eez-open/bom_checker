import { describe, expect, it } from "vitest";
import { QuotaExceededError } from "../suppliers/types";
import type { Clock } from "./clock";
import { RateLimiter, type DailyCounter } from "./rate-limiter";

/** A clock that only moves when someone sleeps. */
function fakeClock(): Clock & { slept: number[] } {
    let time = 1_000_000;
    const slept: number[] = [];
    return {
        slept,
        now: () => time,
        sleep: ms => {
            slept.push(ms);
            time += ms;
            return Promise.resolve();
        }
    };
}

function counter(start = 0): DailyCounter & { count: number } {
    const state = {
        count: start,
        used: () => state.count,
        add: (n: number) => {
            state.count += n;
        }
    };
    return state;
}

describe("RateLimiter", () => {
    it("keeps the minimum time between requests", async () => {
        const clock = fakeClock();
        const limiter = new RateLimiter(
            { minIntervalMs: 600, perMinute: 0, perDay: 0 },
            counter(),
            clock
        );
        await limiter.acquire();
        await limiter.acquire();
        await limiter.acquire();
        expect(clock.slept).toEqual([600, 600]);
    });

    it("waits when the per-minute limit is reached", async () => {
        const clock = fakeClock();
        const limiter = new RateLimiter(
            { minIntervalMs: 0, perMinute: 3, perDay: 0 },
            counter(),
            clock
        );
        for (let i = 0; i < 4; i++) {
            await limiter.acquire();
        }
        // Three immediate requests, then a wait for the first to age out.
        expect(clock.slept).toEqual([60_000]);
    });

    it("counts requests and stops at the daily limit", async () => {
        const used = counter(998);
        const limiter = new RateLimiter(
            { minIntervalMs: 0, perMinute: 0, perDay: 1000 },
            used,
            fakeClock()
        );
        expect(limiter.remainingToday()).toBe(2);
        await limiter.acquire();
        await limiter.acquire();
        expect(used.count).toBe(1000);
        expect(limiter.remainingToday()).toBe(0);
        await expect(limiter.acquire()).rejects.toBeInstanceOf(
            QuotaExceededError
        );
    });

    it("has no daily limit when it is 0", () => {
        const limiter = new RateLimiter(
            { minIntervalMs: 0, perMinute: 0, perDay: 0 },
            counter(5000),
            fakeClock()
        );
        expect(limiter.remainingToday()).toBeNull();
    });
});
