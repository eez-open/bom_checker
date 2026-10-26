// What to collect for a supplier, and summaries of a run. Shared, so the
// Collect dialog and the tests use the same rules.

import {
    partNumberKey,
    type LookupResult,
    type Project,
    type SupplierId
} from "./model";
import { hasAlternatives, isPartNumberDefined } from "./part-number";

export type CollectMode = "all" | "missing" | "continue";

export interface SupplierWork {
    /** Distinct part numbers in the BOM (flagged cells excluded). */
    total: number;
    /** Cells listing alternatives ("A or B"); never collected. */
    flagged: number;
    /** Part numbers with no collected data yet. */
    missing: number;
    /** Part numbers an interrupted run didn't reach; 0 if it finished. */
    remaining: number;
}

/** Distinct part numbers of a supplier, keyed by `partNumberKey`, with
 *  the text of the first cell that has it. */
function partNumbers(
    project: Project,
    supplier: SupplierId
): { byKey: Map<string, string>; flagged: number } {
    const byKey = new Map<string, string>();
    let flagged = 0;
    for (const row of project.rows) {
        const value = row.partNumbers[supplier];
        if (!isPartNumberDefined(value)) {
            continue;
        }
        if (hasAlternatives(value)) {
            flagged++;
            continue;
        }
        const key = partNumberKey(value!);
        if (!byKey.has(key)) {
            byKey.set(key, value!.trim());
        }
    }
    return { byKey, flagged };
}

function isPending(
    result: LookupResult | undefined,
    mode: CollectMode,
    runId: string | undefined
): boolean {
    switch (mode) {
        case "all":
            return true;
        case "missing":
            return result === undefined;
        case "continue":
            return result?.runId !== runId;
    }
}

export function supplierWork(
    project: Project,
    supplier: SupplierId
): SupplierWork {
    const { byKey, flagged } = partNumbers(project, supplier);
    const results = project.collected.results[supplier] ?? {};
    const run = project.collected.runs[supplier];
    const unfinished = run && run.state !== "complete";
    let missing = 0;
    let remaining = 0;
    for (const key of byKey.keys()) {
        missing += isPending(results[key], "missing", undefined) ? 1 : 0;
        if (unfinished) {
            remaining += isPending(results[key], "continue", run.id) ? 1 : 0;
        }
    }
    return { total: byKey.size, flagged, missing, remaining };
}

/** The part numbers to look up, as typed in the BOM. */
export function partNumbersToCollect(
    project: Project,
    supplier: SupplierId,
    mode: CollectMode
): string[] {
    const { byKey } = partNumbers(project, supplier);
    const results = project.collected.results[supplier] ?? {};
    const runId = project.collected.runs[supplier]?.id;
    return [...byKey]
        .filter(([key]) => isPending(results[key], mode, runId))
        .map(([, partNumber]) => partNumber);
}

export interface RunSummary {
    requested: number;
    found: number;
    notFound: number;
    ambiguous: number;
    errors: number;
    /** Found, with enough stock for the BOM quantity. */
    inStock: number;
    /** Found, without enough stock. */
    notInStock: number;
}

/** Counts the part numbers looked up in run `runId`. */
export function summarizeRun(
    project: Project,
    supplier: SupplierId,
    runId: string
): RunSummary {
    const needed = new Map<string, number>();
    for (const row of project.rows) {
        const value = row.partNumbers[supplier];
        if (isPartNumberDefined(value)) {
            const key = partNumberKey(value!);
            needed.set(key, (needed.get(key) ?? 0) + row.qty);
        }
    }
    const summary: RunSummary = {
        requested: 0,
        found: 0,
        notFound: 0,
        ambiguous: 0,
        errors: 0,
        inStock: 0,
        notInStock: 0
    };
    for (const [key, result] of Object.entries(
        project.collected.results[supplier] ?? {}
    )) {
        if (result.runId !== runId || !needed.has(key)) {
            continue;
        }
        summary.requested++;
        if (result.status === "found") {
            summary.found++;
            if (result.offer.stockQty >= (needed.get(key) ?? 0)) {
                summary.inStock++;
            } else {
                summary.notInStock++;
            }
        } else if (result.status === "notFound") {
            summary.notFound++;
        } else if (result.status === "ambiguous") {
            summary.ambiguous++;
        } else {
            summary.errors++;
        }
    }
    return summary;
}
