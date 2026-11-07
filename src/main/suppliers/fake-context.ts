// A SupplierContext whose HTTP requests are answered by a function, for
// plugin tests. Not used by the app.

import { defaultSupplierConfig } from "../../shared/supplier-config";
import { accountOf } from "../../shared/suppliers";
import type { SupplierId } from "../../shared/model";
import type { HttpRequest } from "../collection/http";
import type { SupplierContext } from "./types";

export interface FakeAnswer {
    status?: number;
    body?: unknown;
    headers?: Record<string, string>;
}

export function fakeContext(
    supplier: SupplierId,
    secrets: Record<string, string>,
    answer: (request: HttpRequest, url: URL) => FakeAnswer
): SupplierContext & { requests: HttpRequest[]; remaining: number[] } {
    const requests: HttpRequest[] = [];
    const remaining: number[] = [];
    return {
        requests,
        remaining,
        config: defaultSupplierConfig(accountOf(supplier)),
        secrets,
        baseUrl: () => "https://api.test",
        addSecret: () => undefined,
        reportRemaining: value => remaining.push(value),
        signal: new AbortController().signal,
        http: {
            request: request => {
                requests.push(request);
                const {
                    status = 200,
                    body = {},
                    headers = {}
                } = answer(request, new URL(request.url));
                const text =
                    typeof body === "string" ? body : JSON.stringify(body);
                return Promise.resolve({
                    status,
                    headers: new Headers(headers),
                    text,
                    json: () => JSON.parse(text) as unknown
                });
            }
        }
    };
}
