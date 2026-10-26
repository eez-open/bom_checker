import { SupplierError } from "../suppliers/types";
import { realClock, type Clock } from "./clock";

export interface HttpRequest {
    method: "GET" | "POST";
    url: string;
    headers?: Record<string, string>;
    body?: string;
}

export interface HttpResponse {
    status: number;
    headers: Headers;
    text: string;
    /** The body as JSON; throws SupplierError if it isn't JSON. */
    json(): unknown;
}

export interface Http {
    request(request: HttpRequest): Promise<HttpResponse>;
}

/** Replaces secret values (API keys, tokens) with *** in logged text. */
export class Redactor {
    private readonly values = new Set<string>();

    add(value: string | undefined): void {
        if (value && value.length >= 4) {
            this.values.add(value);
            this.values.add(encodeURIComponent(value));
        }
    }

    redact(text: string): string {
        let result = text;
        for (const value of this.values) {
            result = result.split(value).join("***");
        }
        return result;
    }
}

export interface HttpOptions {
    /** Supplier name for log lines. */
    name: string;
    limiter: { acquire(signal?: AbortSignal): Promise<void> };
    signal: AbortSignal;
    redactor: Redactor;
    /** Also log response bodies (Settings → General). */
    logBodies: boolean;
    log: { info(...args: unknown[]): void; warn(...args: unknown[]): void };
    fetch?: typeof fetch;
    clock?: Clock;
    timeoutMs?: number;
}

const MAX_ATTEMPTS = 3;
/** Longer waits (e.g. a daily limit) are left to the plugin to report. */
const MAX_AUTOMATIC_WAIT_MS = 60_000;
const MAX_LOGGED_BODY = 20_000;

/**
 * An HTTP client for one supplier: every request waits for the rate
 * limiter. Network errors and HTTP 5xx are retried with a growing pause,
 * HTTP 429 after its Retry-After time. Other statuses are returned for the
 * plugin to interpret.
 */
export function createHttp(options: HttpOptions): Http {
    const {
        name,
        limiter,
        signal,
        redactor,
        logBodies,
        log,
        fetch: fetchFn = globalThis.fetch,
        clock = realClock,
        timeoutMs = 30_000
    } = options;

    return {
        async request({ method, url, headers, body }) {
            const shownUrl = redactor.redact(url);
            for (let attempt = 1; ; attempt++) {
                await limiter.acquire(signal);
                const started = clock.now();
                let response: Response;
                try {
                    response = await fetchFn(url, {
                        method,
                        headers,
                        body,
                        signal: AbortSignal.any([
                            signal,
                            AbortSignal.timeout(timeoutMs)
                        ])
                    });
                } catch (error) {
                    if (signal.aborted) {
                        throw error;
                    }
                    const reason = redactor.redact(describeNetworkError(error));
                    log.warn(
                        `[${name}] ${method} ${shownUrl} failed: ${reason}`
                    );
                    if (attempt >= MAX_ATTEMPTS) {
                        throw new SupplierError(
                            `Can't reach ${new URL(url).host}: ${reason}`
                        );
                    }
                    await clock.sleep(1000 * 2 ** (attempt - 1), signal);
                    continue;
                }

                const text = await response.text();
                log.info(
                    `[${name}] ${method} ${shownUrl} → ${response.status} ` +
                        `(${clock.now() - started} ms)`
                );
                if (logBodies) {
                    log.info(
                        `[${name}] response:`,
                        redactor.redact(text.slice(0, MAX_LOGGED_BODY))
                    );
                }

                const wait = retryWait(response, attempt);
                if (wait !== null && attempt < MAX_ATTEMPTS) {
                    await clock.sleep(wait, signal);
                    continue;
                }
                const status = response.status;
                return {
                    status,
                    headers: response.headers,
                    text,
                    json() {
                        try {
                            return JSON.parse(text) as unknown;
                        } catch {
                            throw new SupplierError(
                                `Unexpected answer from ${name} (HTTP ${status}).`
                            );
                        }
                    }
                };
            }
        }
    };
}

/** How long to wait before retrying, or null to return the response. */
function retryWait(response: Response, attempt: number): number | null {
    if (response.status >= 500) {
        return 1000 * 2 ** (attempt - 1);
    }
    if (response.status === 429) {
        const wait = retryAfterMs(response.headers) ?? 2000 * attempt;
        return wait <= MAX_AUTOMATIC_WAIT_MS ? wait : null;
    }
    return null;
}

/** The Retry-After header (seconds or an HTTP date) in milliseconds. */
export function retryAfterMs(headers: Headers): number | null {
    const value = headers.get("retry-after");
    if (!value) {
        return null;
    }
    const seconds = Number(value);
    if (Number.isFinite(seconds)) {
        return Math.max(0, seconds * 1000);
    }
    const date = Date.parse(value);
    return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function describeNetworkError(error: unknown): string {
    if (error instanceof Error) {
        const cause = (error.cause as { code?: string } | undefined)?.code;
        if (error.name === "TimeoutError") {
            return "no answer (timed out)";
        }
        return cause ? `${error.message} (${cause})` : error.message;
    }
    return String(error);
}
