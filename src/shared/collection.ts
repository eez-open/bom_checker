// What to collect for a supplier, and summaries of a run. Shared, so the
// Collect dialog and the tests use the same rules.

import {
    partNumberKey,
    SUPPLIER_IDS,
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
import { SUPPLIERS } from "./suppliers";

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

/** What a collection covers, besides the supplier. */
export interface CollectScope {
    /** Also the Values of rows without a part number ("Look up the Value"). */
    byValue?: boolean;
    /** Also, for an empty cell of an Arrow inventory source, the part
     *  number of another source (`sharedPartNumber`); on where the cells
     *  can be filled in afterwards. */
    shared?: boolean;
    /** Only these rows, e.g. the ones selected in the table (#17); all rows
     *  when not given. */
    rowIds?: ReadonlySet<string>;
}

export interface SupplierWork {
    /** Distinct part numbers in the BOM (flagged cells excluded). */
    total: number;
    /** Cells listing alternatives ("A or B"); never collected. */
    flagged: number;
    /** Part numbers with no collected data yet, or only an error. */
    missing: number;
    /** Part numbers an interrupted run didn't reach; 0 if it finished. */
    remaining: number;
    /** Rows without a part number whose Value could be looked up. */
    valueRows: number;
}

function rowsIn(project: Project, scope: CollectScope): readonly BomRow[] {
    const { rowIds } = scope;
    return rowIds
        ? project.rows.filter(row => rowIds.has(row.id))
        : project.rows;
}

/** The part numbers in a row's other columns of `supplier`'s account
 *  (Arrow's inventory sources), in column order; alternatives too. */
function otherSourcesCells(row: BomRow, supplier: SupplierId): string[] {
    const account = SUPPLIERS[supplier].account;
    return SUPPLIER_IDS.filter(
        other => other !== supplier && SUPPLIERS[other].account === account
    )
        .map(other => row.partNumbers[other])
        .filter(isPartNumberDefined)
        .map(normalizeCell);
}

/**
 * For a row without a part number for `supplier`, the part number of
 * another supplier of the same account: Arrow's inventory sources sell by
 * manufacturer part number, so one typed for Arrow (EUROPE) is looked up
 * for Arrow (ACNA) too. The first in column order that doesn't list
 * alternatives; null if the cell isn't empty ("-" means the supplier has no
 * such part) or no other source of the account has one.
 */
export function sharedPartNumber(
    row: BomRow,
    supplier: SupplierId
): string | null {
    return normalizeCell(row.partNumbers[supplier]) === ""
        ? (otherSourcesCells(row, supplier).find(
              cell => !hasAlternatives(cell)
          ) ?? null)
        : null;
}

/**
 * The Value to look up for a row without a part number for the supplier
 * (the "Look up the Value" option); null if the cell isn't empty ("-" means
 * the supplier has no such part), the Value isn't a part number, or (with
 * `shared`) another Arrow source has a part number, which comes first.
 */
function valueQuery(
    row: BomRow,
    supplier: SupplierId,
    shared: boolean
): string | null {
    return normalizeCell(row.partNumbers[supplier]) === "" &&
        !(shared && otherSourcesCells(row, supplier).length > 0)
        ? valueAsPartNumber(row.value)
        : null;
}

/** Distinct part numbers of a supplier in the rows of `scope`, keyed by
 *  `partNumberKey`, with the text of the first cell that has it; with
 *  `shared`, also other Arrow sources' part numbers for empty cells, and
 *  with `byValue`, the Values of rows still without one. */
function partNumbers(
    project: Project,
    supplier: SupplierId,
    scope: CollectScope
): { byKey: Map<string, string>; flagged: number; valueRows: number } {
    const rows = rowsIn(project, scope);
    const byKey = new Map<string, string>();
    let flagged = 0;
    for (const row of rows) {
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
    const add = (query: string) => {
        if (!byKey.has(partNumberKey(query))) {
            byKey.set(partNumberKey(query), query);
        }
    };
    let valueRows = 0;
    for (const row of rows) {
        const shared = scope.shared ? sharedPartNumber(row, supplier) : null;
        if (shared) {
            add(shared);
            continue;
        }
        const query = valueQuery(row, supplier, scope.shared ?? false);
        if (query) {
            valueRows++;
            if (scope.byValue) {
                add(query);
            }
        }
    }
    return { byKey, flagged, valueRows };
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
            // An error isn't data: try again.
            return result === undefined || result.status === "error";
        case "continue":
            return result?.runId !== runId;
    }
}

export function supplierWork(
    project: Project,
    supplier: SupplierId,
    scope: CollectScope = {}
): SupplierWork {
    const { byKey, flagged, valueRows } = partNumbers(project, supplier, scope);
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
    return { total: byKey.size, flagged, missing, remaining, valueRows };
}

/** The part numbers to look up, as typed in the BOM. */
export function partNumbersToCollect(
    project: Project,
    supplier: SupplierId,
    mode: CollectMode,
    scope: CollectScope = {}
): string[] {
    const { byKey } = partNumbers(project, supplier, scope);
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

/** Keys of collected results by supplier. */
export type ResultKeys = Partial<Record<SupplierId, Set<string>>>;

/**
 * The collected results of the rows `rowIds` (#40), for every supplier:
 * of their part numbers, and of their Values when they were looked up.
 * Only keys that have a result; `rows` counts the rows with any.
 */
export function collectedKeysOf(
    project: Project,
    rowIds: ReadonlySet<string>
): { keys: ResultKeys; rows: number } {
    const keys: ResultKeys = {};
    let rows = 0;
    for (const row of rowsIn(project, { rowIds })) {
        let found = false;
        for (const supplier of SUPPLIER_IDS) {
            const results = project.collected.results[supplier] ?? {};
            const cell = row.partNumbers[supplier];
            const value = valueAsPartNumber(row.value);
            for (const text of [
                isPartNumberDefined(cell) && !hasAlternatives(cell)
                    ? cell!
                    : null,
                sharedPartNumber(row, supplier),
                value
            ]) {
                const key = text === null ? null : partNumberKey(text);
                if (key !== null && results[key]) {
                    (keys[supplier] ??= new Set()).add(key);
                    found = true;
                }
            }
        }
        rows += found ? 1 : 0;
    }
    return { keys, rows };
}

/** `collected` without the results `keys`; the same object if it has none
 *  of them. Data is kept per part number, so rows with the same part
 *  numbers lose it too. */
export function withoutResults(
    collected: CollectedData,
    keys: ResultKeys
): CollectedData {
    const results = { ...collected.results };
    let changed = false;
    for (const [supplier, forgotten] of Object.entries(keys) as [
        SupplierId,
        Set<string>
    ][]) {
        const theirs = Object.entries(results[supplier] ?? {});
        const kept = theirs.filter(([key]) => !forgotten.has(key));
        if (kept.length < theirs.length) {
            results[supplier] = Object.fromEntries(kept);
            changed = true;
        }
    }
    return changed ? { ...collected, results } : collected;
}

export interface ValueMatches {
    /** Cells to fill: the supplier's part number for a single match, or the
     *  Value when several items match, so the user can choose one. */
    cells: { rowId: string; partNumber: string; result: LookupResult }[];
    found: number;
    ambiguous: number;
    notFound: number;
}

/**
 * What was found for the Values of rows (in `rowIds`, if given) without a
 * part number, other than rows that take another Arrow source's part
 * number (`sharedMatches`). Results of earlier runs count too: "Only part
 * numbers without data" doesn't look them up again (#18).
 */
export function valueMatches(
    project: Project,
    supplier: SupplierId,
    rowIds?: ReadonlySet<string>
): ValueMatches {
    const matches: ValueMatches = {
        cells: [],
        found: 0,
        ambiguous: 0,
        notFound: 0
    };
    const results = project.collected.results[supplier] ?? {};
    for (const row of rowsIn(project, { rowIds })) {
        const query = valueQuery(row, supplier, true);
        const result = query ? results[partNumberKey(query)] : undefined;
        if (!query || !result) {
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

/**
 * Empty cells of an Arrow inventory source (in rows `rowIds`, if given)
 * that get another source's part number (`sharedPartNumber`): the ones it
 * was looked up for, found or not, so the column shows what the source
 * has. Not after an error: the next collect tries again.
 */
export function sharedMatches(
    project: Project,
    supplier: SupplierId,
    rowIds?: ReadonlySet<string>
): { rowId: string; partNumber: string }[] {
    const results = project.collected.results[supplier] ?? {};
    return rowsIn(project, { rowIds }).flatMap(row => {
        const partNumber = sharedPartNumber(row, supplier);
        const result = partNumber
            ? results[partNumberKey(partNumber)]
            : undefined;
        return partNumber && result && result.status !== "error"
            ? [{ rowId: row.id, partNumber }]
            : [];
    });
}

/**
 * `collected` without results older than their supplier's terms allow
 * (#62: Arrow's, 48 hours). The same object when none are. Main applies it
 * whenever a BOM's data is read or written.
 */
export function withoutExpired(
    collected: CollectedData,
    now: number
): CollectedData {
    let results = collected.results;
    for (const supplier of SUPPLIER_IDS) {
        const maxAge = SUPPLIERS[supplier].maxAgeMs;
        const kept = collected.results[supplier];
        if (!maxAge || !kept) {
            continue;
        }
        const fresh = Object.entries(kept).filter(
            ([, result]) => now - Date.parse(result.fetchedAt) <= maxAge
        );
        if (fresh.length < Object.keys(kept).length) {
            results = { ...results, [supplier]: Object.fromEntries(fresh) };
        }
    }
    return results === collected.results
        ? collected
        : { ...collected, results };
}
