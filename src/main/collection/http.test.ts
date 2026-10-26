import { describe, expect, it } from "vitest";
import { SupplierError } from "../suppliers/types";
import type { Clock } from "./clock";
import { createHttp, Redactor } from "./http";

function setup(responses: (Response | Error)[], logBodies = false) {
    const slept: number[] = [];
    const logged: string[] = [];
    const urls: string[] = [];
    const clock: Clock = {
        now: () => 0,
        sleep: ms => {
            slept.push(ms);
            return Promise.resolve();
        }
    };
    const redactor = new Redactor();
    redactor.add("SECRET-KEY-123");
    let acquired = 0;
    const http = createHttp({
        name: "test",
        limiter: {
            acquire: () => {
                acquired++;
                return Promise.resolve();
            }
        },
        signal: new AbortController().signal,
        redactor,
        logBodies,
        log: {
            info: (...args) => logged.push(args.join(" ")),
            warn: (...args) => logged.push(args.join(" "))
        },
        clock,
        fetch: (url: string | URL | Request) => {
            urls.push(
                typeof url === "string"
                    ? url
                    : url instanceof URL
                      ? url.href
                      : url.url
            );
            const next = responses.shift();
            if (!next) {
                throw new Error("no more responses");
            }
            return next instanceof Error
                ? Promise.reject(next)
                : Promise.resolve(next);
        }
    });
    return { http, slept, logged, urls, acquired: () => acquired };
}

const URL_WITH_KEY = "https://api.example.com/search?apiKey=SECRET-KEY-123";

describe("http client", () => {
    it("returns JSON and logs without secrets", async () => {
        const { http, logged, acquired } = setup(
            [new Response('{"ok":true,"key":"SECRET-KEY-123"}')],
            true
        );
        const response = await http.request({
            method: "GET",
            url: URL_WITH_KEY
        });
        expect(response.status).toBe(200);
        expect(response.json()).toEqual({
            ok: true,
            key: "SECRET-KEY-123"
        });
        expect(acquired()).toBe(1);
        expect(logged.join("\n")).not.toContain("SECRET-KEY-123");
        expect(logged.join("\n")).toContain("apiKey=***");
    });

    it("retries server errors with a growing pause", async () => {
        const { http, slept, acquired } = setup([
            new Response("", { status: 503 }),
            new Response("", { status: 502 }),
            new Response("{}")
        ]);
        const response = await http.request({
            method: "GET",
            url: URL_WITH_KEY
        });
        expect(response.status).toBe(200);
        expect(slept).toEqual([1000, 2000]);
        expect(acquired()).toBe(3);
    });

    it("waits for Retry-After on HTTP 429", async () => {
        const { http, slept } = setup([
            new Response("", { status: 429, headers: { "Retry-After": "5" } }),
            new Response("{}")
        ]);
        await http.request({ method: "GET", url: URL_WITH_KEY });
        expect(slept).toEqual([5000]);
    });

    it("returns HTTP 429 at once when the wait is long", async () => {
        const { http, slept } = setup([
            new Response("", {
                status: 429,
                headers: { "Retry-After": "3600" }
            })
        ]);
        const response = await http.request({
            method: "GET",
            url: URL_WITH_KEY
        });
        expect(response.status).toBe(429);
        expect(slept).toEqual([]);
    });

    it("gives up after repeated network errors", async () => {
        const { http, slept } = setup([
            new TypeError("fetch failed"),
            new TypeError("fetch failed"),
            new TypeError("fetch failed")
        ]);
        await expect(
            http.request({ method: "GET", url: URL_WITH_KEY })
        ).rejects.toThrow(SupplierError);
        expect(slept).toEqual([1000, 2000]);
    });

    it("reports answers that aren't JSON", async () => {
        const { http } = setup([
            new Response("<html>", { status: 502 }),
            new Response("<html>", { status: 502 }),
            new Response("<html>", { status: 502 })
        ]);
        const response = await http.request({
            method: "GET",
            url: URL_WITH_KEY
        });
        expect(() => response.json()).toThrow(/Unexpected answer/);
    });
});
