// What to collect for a supplier, and summaries of a run. Shared, so the
// Collect dialog and the tests use the same rules.

import {
    partNumberKey,
    type BomRow,
    type CollectedData,
    type LookupResult,
    type Project,
    type SupplierId
} from "./model";
import {
    hasAlternatives,
    isPartNumberDefined,
    normalizeCell,
    valueAsPartNumber
} from "./part-number";
import { orderQuantity } from "./pricing";

export type CollectMode = "all" | "missing" | "continue";

/** When data was last collected from a supplier (ISO time): the end of
 *  its latest run or its newest result, whichever is later. */
export function lastCollectedAt(
    collected: CollectedData,
    supplier: SupplierId
): string | null {
    let latest = collected.runs[supplier]?.endedAt ?? null;
    for (const result of Object.values(collected.results[supplier] ?? {})) {
        if (!latest || result.fetchedAt > latest) {
            latest = result.fetchedAt;
        }
    }
    return latest;
}

/** "2026-10-26 17:45" in local time: unambiguous in every language. */
export function formatDateTime(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
        return iso;
    }
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-` +
        `${pad(date.getDate())} ${pad(date.getHours())}:` +
        pad(date.getMinutes())
    );
}

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

/**
 * The Value to look up for a row without a part number for the supplier
 * (the "Look up the Value" option); null if the cell isn't empty ("-" means
 * the supplier has no such part) or the Value isn't a part number.
 */
function valueQuery(row: BomRow, supplier: SupplierId): string | null {
    return normalizeCell(row.partNumbers[supplier]) === ""
        ? valueAsPartNumber(row.value)
        : null;
}

/** Distinct part numbers of a supplier, keyed by `partNumberKey`, with
 *  the text of the first cell that has it; with `byValue`, also the
 *  Values of rows without a part number. */
function partNumbers(
    project: Project,
    supplier: SupplierId,
    byValue: boolean
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
    if (byValue) {
        for (const row of project.rows) {
            const query = valueQuery(row, supplier);
            if (query && !byKey.has(partNumberKey(query))) {
                byKey.set(partNumberKey(query), query);
            }
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
    supplier: SupplierId,
    byValue = false
): SupplierWork {
    const { byKey, flagged } = partNumbers(project, supplier, byValue);
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
    mode: CollectMode,
    byValue = false
): string[] {
    const { byKey } = partNumbers(project, supplier, byValue);
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
    /** Found, with enough stock for the order quantity. */
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
            needed.set(
                key,
                (needed.get(key) ?? 0) + row.qty * project.buildQuantity
            );
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
            const { offer } = result;
            const orderQty = orderQuantity(
                needed.get(key) ?? 0,
                offer.moq,
                offer.orderMultiple
            );
            if (offer.stockQty >= orderQty) {
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

export interface ValueMatches {
    /** Cells to fill: the supplier's part number for a single match, or the
     *  Value when several items match, so the user can choose one. */
    cells: { rowId: string; partNumber: string; result: LookupResult }[];
    found: number;
    ambiguous: number;
    notFound: number;
}

/** What run `runId` found for the rows it looked up by Value. */
export function valueMatches(
    project: Project,
    supplier: SupplierId,
    runId: string
): ValueMatches {
    const matches: ValueMatches = {
        cells: [],
        found: 0,
        ambiguous: 0,
        notFound: 0
    };
    const results = project.collected.results[supplier] ?? {};
    for (const row of project.rows) {
        const query = valueQuery(row, supplier);
        const result = query ? results[partNumberKey(query)] : undefined;
        if (!query || result?.runId !== runId) {
            continue;
        }
        if (result.status === "found") {
            matches.found++;
            matches.cells.push({
                rowId: row.id,
                partNumber: result.offer.supplierPartNumber,
                result
            });
        } else if (result.status === "ambiguous") {
            matches.ambiguous++;
            matches.cells.push({ rowId: row.id, partNumber: query, result });
        } else {
            matches.notFound++;
        }
    }
    return matches;
}
