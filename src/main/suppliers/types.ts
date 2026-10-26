// The interface every supplier integration implements. Plugins run in the
// main process and are compiled into the app ("BOM checker
// architecture.md", 6.1).

import type { LookupOutcome, SupplierId } from "../../shared/model";
import type { SupplierConfig } from "../../shared/supplier-config";
import type { Http } from "../collection/http";

export interface SupplierContext {
    config: SupplierConfig;
    /** Credentials from the unlocked vault. */
    secrets: Record<string, string>;
    /** Rate-limited HTTP client for this supplier. */
    http: Http;
    /** The API base URL: `defaultUrl`, or an override used by tests. */
    baseUrl(defaultUrl: string): string;
    /** Hides a value, such as an access token, in logs. */
    addSecret(value: string): void;
    /** For suppliers that report how many requests are left today. */
    reportRemaining(remaining: number): void;
    signal: AbortSignal;
}

export interface SupplierPlugin {
    id: SupplierId;
    /** Part numbers per `lookup` call. */
    batchSize: number;
    /** HTTP requests per batch, for estimates shown before collecting. */
    requestsPerBatch: number;
    /** Secret fields that must be set before collecting. */
    requiredSecrets: readonly string[];
    /** A part number that should always exist, for "Test connection". */
    testPartNumber: string;
    /**
     * Looks up a batch. Returns an outcome for each input, keyed by
     * `partNumberKey()`. Throws AuthError or QuotaExceededError to stop the
     * run, ThrottledError to have the batch retried later; any other error
     * marks the batch as failed.
     */
    lookup(
        partNumbers: readonly string[],
        context: SupplierContext
    ): Promise<Map<string, LookupOutcome>>;
}

/** The supplier rejected the credentials; the run stops. */
export class AuthError extends Error {
    override name = "AuthError";
}

/** The daily request limit is used up; the run stops and can be continued
 *  later. */
export class QuotaExceededError extends Error {
    override name = "QuotaExceededError";
}

/** Too many requests right now; the batch is retried after a pause. */
export class ThrottledError extends Error {
    override name = "ThrottledError";
    constructor(
        message: string,
        readonly retryAfterMs: number
    ) {
        super(message);
    }
}

/** An unexpected answer; the part numbers of the batch get an error. */
export class SupplierError extends Error {
    override name = "SupplierError";
}
