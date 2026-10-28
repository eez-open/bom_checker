// Unifying part numbers across the BOMs of a list (#35). Rows are the same
// component when Value and Footprint are equal, or when they already share
// a supplier part number. Where such rows have different part numbers for
// a supplier (an empty cell counts too), every part number used for the
// component, in the BOMs and in the history, is offered with stock and
// prices for the quantity of all rows, to choose one.

import { componentKey, definedPartNumbers, type ListMember } from "./bom-list";
import {
    partNumberKey,
    SUPPLIER_IDS,
    type BomRow,
    type CollectedData,
    type Project,
    type SupplierId
} from "./model";
import { normalizeCell } from "./part-number";
import { supplierLine, type SupplierLine } from "./pricing";
import { addSupplier, createRow, setCell } from "./project-ops";

export interface UnifyRow {
    /** The BOM's file. */
    bom: string;
    bomName: string;
    rowId: string;
    reference: string;
    value: string;
    /** Qty × the BOM's build quantity. */
    qty: number;
    /** The supplier cells, trimmed ("" for an empty one). */
    cells: Partial<Record<SupplierId, string>>;
}

export interface Candidate {
    /** As in the first cell that has it; "-" means no part at the supplier. */
    partNumber: string;
    /** BOM rows that have it; 0 for one from the history only. */
    rows: number;
    /** Names of the BOMs that use it, then "history" if the history has it. */
    usedIn: string[];
}

export interface UnifyGroup {
    id: string;
    footprint: string;
    /** The tidied Values of the rows, most used first. */
    values: string[];
    rows: UnifyRow[];
    /** The quantity of all rows, which prices are compared for. */
    totalQty: number;
    /** Suppliers whose cells differ between the rows, with the part numbers
     *  to choose from: the most used first, then the history's. */
    suppliers: Partial<Record<SupplierId, Candidate[]>>;
}

/** What to do with a group: null keeps the cells as they are. */
export interface UnifyDecision {
    value: string | null;
    suppliers: Partial<Record<SupplierId, string | null>>;
}

export const HISTORY_NAME = "history";

function tidy(text: string): string {
    return text.trim().replace(/\s+/g, " ");
}

/** A cell's identity: its part number key, "-", or "" when empty. */
function cellKey(cell: string): string {
    return cell === "" || cell === "-" ? cell : partNumberKey(cell);
}

class UnionFind {
    private parent: number[] = [];
    add(): number {
        this.parent.push(this.parent.length);
        return this.parent.length - 1;
    }
    find(i: number): number {
        while (this.parent[i] !== i) {
            this.parent[i] = this.parent[this.parent[i]!]!;
            i = this.parent[i]!;
        }
        return i;
    }
    union(a: number, b: number): void {
        this.parent[this.find(a)] = this.find(b);
    }
}

function byCount<T>(counts: Map<T, number>): T[] {
    // Stable: equal counts keep the order of first use.
    return [...counts].sort((a, b) => b[1] - a[1]).map(([item]) => item);
}

/** The groups of rows to unify, in the order of their first row. */
export function findUnifyGroups(
    members: readonly ListMember[],
    history: Project | null,
    { matchFootprint = true } = {}
): UnifyGroup[] {
    const rows: { member: ListMember; row: BomRow }[] = [];
    const sets = new UnionFind();
    const firstWith = new Map<string, number>();
    const join = (key: string, index: number) => {
        const first = firstWith.get(key);
        if (first === undefined) {
            firstWith.set(key, index);
        } else {
            sets.union(index, first);
        }
    };
    for (const member of members) {
        for (const row of member.project.rows) {
            const index = sets.add();
            rows.push({ member, row });
            join(`c:${componentKey(row, matchFootprint)}`, index);
            for (const [supplier, partNumber] of Object.entries(
                definedPartNumbers(row)
            )) {
                join(`p:${supplier}:${partNumberKey(partNumber)}`, index);
            }
        }
    }

    const grouped = new Map<number, number[]>();
    rows.forEach((_, index) => {
        const root = sets.find(index);
        grouped.set(root, [...(grouped.get(root) ?? []), index]);
    });

    const suppliers = SUPPLIER_IDS.filter(supplier =>
        members.some(member => member.project.suppliers.includes(supplier))
    );
    const groups: UnifyGroup[] = [];
    for (const indexes of grouped.values()) {
        if (indexes.length < 2) {
            continue;
        }
        const entries = indexes.map(index => rows[index]!);
        const group = describeGroup(
            entries,
            history,
            suppliers,
            matchFootprint
        );
        if (group) {
            groups.push(group);
        }
    }
    return groups;
}

function describeGroup(
    entries: { member: ListMember; row: BomRow }[],
    history: Project | null,
    suppliers: readonly SupplierId[],
    matchFootprint: boolean
): UnifyGroup | null {
    const rows: UnifyRow[] = entries.map(({ member, row }) => ({
        bom: member.path,
        bomName: member.name,
        rowId: row.id,
        reference: row.reference.trim(),
        value: tidy(row.value),
        qty: row.qty * member.project.buildQuantity,
        cells: Object.fromEntries(
            suppliers.map(supplier => [
                supplier,
                normalizeCell(row.partNumbers[supplier])
            ])
        )
    }));

    const valueCounts = new Map<string, number>();
    for (const row of rows) {
        valueCounts.set(row.value, (valueCounts.get(row.value) ?? 0) + 1);
    }
    const values = byCount(valueCounts);

    // The history's rows of this component.
    const keys = new Set(
        entries.map(({ row }) => componentKey(row, matchFootprint))
    );
    const historyRows = (history?.rows ?? []).filter(row =>
        keys.has(componentKey(row, matchFootprint))
    );

    const choices: Partial<Record<SupplierId, Candidate[]>> = {};
    for (const supplier of suppliers) {
        const cells = rows.map(row => row.cells[supplier] ?? "");
        if (new Set(cells.map(cellKey)).size < 2) {
            continue;
        }
        const candidates = new Map<string, Candidate>();
        for (const [index, cell] of cells.entries()) {
            if (cell === "") {
                continue;
            }
            const key = cellKey(cell);
            const candidate = candidates.get(key) ?? {
                partNumber: cell,
                rows: 0,
                usedIn: []
            };
            candidate.rows++;
            const name = rows[index]!.bomName;
            if (!candidate.usedIn.includes(name)) {
                candidate.usedIn.push(name);
            }
            candidates.set(key, candidate);
        }
        const used = [...candidates.values()].sort((a, b) => b.rows - a.rows);
        for (const row of historyRows) {
            const partNumber = definedPartNumbers(row)[supplier];
            if (!partNumber) {
                continue;
            }
            const known = candidates.get(cellKey(partNumber));
            if (known) {
                if (!known.usedIn.includes(HISTORY_NAME)) {
                    known.usedIn.push(HISTORY_NAME);
                }
            } else {
                const candidate = {
                    partNumber,
                    rows: 0,
                    usedIn: [HISTORY_NAME]
                };
                candidates.set(cellKey(partNumber), candidate);
                used.push(candidate);
            }
        }
        choices[supplier] = used;
    }

    if (Object.keys(choices).length === 0 && values.length < 2) {
        return null;
    }
    const first = entries[0]!.row;
    return {
        id: `${entries[0]!.member.path}#${first.id}`,
        footprint: tidy(first.footprint),
        values,
        rows,
        totalQty: Number(
            rows.reduce((sum, row) => sum + row.qty, 0).toFixed(9)
        ),
        suppliers: choices
    };
}

/** Order quantity, price and stock of a part number for the group's
 *  quantity; null without collected data. */
export function candidateLine(
    group: UnifyGroup,
    supplier: SupplierId,
    partNumber: string,
    collected: CollectedData
): SupplierLine | null {
    return supplierLine(
        createRow({
            qty: group.totalQty,
            partNumbers: { [supplier]: partNumber }
        }),
        supplier,
        collected,
        1
    );
}

/**
 * The suggested choice: per supplier, the part number with the lowest
 * total price among those in stock for the group's quantity, else the most
 * used one the supplier didn't report as not found (none: keep the cells);
 * the most used Value.
 */
export function suggestDecision(
    group: UnifyGroup,
    collected: CollectedData
): UnifyDecision {
    const suppliers: UnifyDecision["suppliers"] = {};
    for (const [supplier, candidates] of Object.entries(group.suppliers) as [
        SupplierId,
        Candidate[]
    ][]) {
        let best: { partNumber: string; total: number } | null = null;
        for (const { partNumber } of candidates) {
            const line = candidateLine(group, supplier, partNumber, collected);
            if (
                line?.total != null &&
                line.availability?.kind === "in-stock" &&
                (!best || line.total < best.total)
            ) {
                best = { partNumber, total: line.total };
            }
        }
        // Not one the supplier said it doesn't have.
        const usable = candidates.filter(
            ({ partNumber }) =>
                partNumber === "-" ||
                collected.results[supplier]?.[partNumberKey(partNumber)]
                    ?.status !== "notFound"
        );
        const mostUsed = usable.find(c => c.partNumber !== "-") ?? usable[0];
        suppliers[supplier] = best?.partNumber ?? mostUsed?.partNumber ?? null;
    }
    return {
        value: group.values.length > 1 ? group.values[0]! : null,
        suppliers
    };
}

export interface UnifyChanges {
    /** The changed BOMs by file. */
    projects: Map<string, Project>;
    /** Changed rows by BOM file. */
    rows: Map<string, number>;
}

/** The BOMs with the decisions applied; only changed ones are returned. */
export function applyDecisions(
    members: readonly ListMember[],
    groups: readonly UnifyGroup[],
    decisions: ReadonlyMap<string, UnifyDecision>
): UnifyChanges {
    const projects = new Map(
        members.map(member => [member.path, member.project])
    );
    const changedRows = new Map<string, Set<string>>();
    for (const group of groups) {
        const decision = decisions.get(group.id);
        if (!decision) {
            continue;
        }
        for (const row of group.rows) {
            let project = projects.get(row.bom);
            if (!project) {
                continue;
            }
            const before = project;
            if (decision.value !== null && row.value !== decision.value) {
                project = setCell(
                    project,
                    row.rowId,
                    { kind: "base", field: "value" },
                    decision.value
                );
            }
            for (const [supplier, partNumber] of Object.entries(
                decision.suppliers
            ) as [SupplierId, string | null][]) {
                // The chosen text exactly, also where only case differs.
                if (
                    partNumber === null ||
                    (row.cells[supplier] ?? "") === partNumber.trim()
                ) {
                    continue;
                }
                project = setCell(
                    addSupplier(project, supplier),
                    row.rowId,
                    { kind: "partNumber", supplier },
                    partNumber.trim()
                );
            }
            if (project !== before) {
                projects.set(row.bom, project);
                const rows = changedRows.get(row.bom) ?? new Set<string>();
                rows.add(row.rowId);
                changedRows.set(row.bom, rows);
            }
        }
    }
    const changed = new Map(
        [...projects].filter(([path]) => changedRows.has(path))
    );
    return {
        projects: changed,
        rows: new Map([...changedRows].map(([path, rows]) => [path, rows.size]))
    };
}
