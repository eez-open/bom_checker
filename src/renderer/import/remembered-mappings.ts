// Remembers the CSV column mapping per set of headers, so re-importing the
// same kind of file needs no changes. Stored in localStorage: it's a
// convenience, so failures to read or write are ignored.

import { targetId, type ColumnTarget } from "../../shared/csv-import";

const STORAGE_KEY = "csv-import-mappings";
const MAX_ENTRIES = 20;

type Stored = Record<string, string[]>;

function signature(headers: readonly string[]): string {
    return JSON.stringify(headers);
}

function read(): Stored {
    try {
        const value: unknown = JSON.parse(
            localStorage.getItem(STORAGE_KEY) ?? "{}"
        );
        return typeof value === "object" && value !== null
            ? (value as Stored)
            : {};
    } catch {
        return {};
    }
}

/** The mapping last used for these headers, as target ids. */
export function rememberedTargetIds(
    headers: readonly string[]
): string[] | undefined {
    const ids = read()[signature(headers)];
    return Array.isArray(ids) && ids.length === headers.length
        ? ids
        : undefined;
}

export function rememberMapping(
    headers: readonly string[],
    mapping: readonly ColumnTarget[]
): void {
    try {
        const stored = read();
        delete stored[signature(headers)];
        stored[signature(headers)] = mapping.map(targetId);
        const entries = Object.entries(stored).slice(-MAX_ENTRIES);
        localStorage.setItem(
            STORAGE_KEY,
            JSON.stringify(Object.fromEntries(entries))
        );
    } catch {
        // Not important enough to bother the user.
    }
}
