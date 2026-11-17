// Unifying part numbers across the BOMs of a list (#35). Rows are the same
// component when Value and Footprint are equal, or when their components
// already share a supplier part number and no other supplier's part numbers
// tell them apart. Where such rows have different part numbers for
// a supplier (an empty cell counts too), every part number used for the
// component, in the BOMs and in the history, is offered with stock and
// prices for the quantity of all rows, to choose one.
//
// Checking the history (#52) offers the same for rows of one BOM: the part
// numbers the history has for their components, e.g. one that was out of
// stock when another was chosen, which may be in stock and cheaper now.
//
// Components that share a part number but are told apart (#90) are offered
// too, each with what it shares with which rows, to choose the right part
// number for its cells.

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
    /** For all devices: Qty × how many of the BOM one device has × the
     *  list's build quantity (#39). */
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
    /** Part numbers that rows of other components have too (#90). Their
     *  suppliers are offered even when the group's cells are the same. */
    shared: SharedPartNumber[];
}

/**
 * A part number that components have which another supplier's part numbers
 * tell apart, e.g. 100n and 10n capacitors (#90): likely a mistake in one
 * of them.
 */
export interface SharedPartNumber {
    supplier: SupplierId;
    /** As in the group's first cell that has it. */
    partNumber: string;
    /** The rows of the other components that have it. */
    rows: Pick<UnifyRow, "bomName" | "reference" | "value">[];
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

/** The rows with the same Value and Footprint. */
interface Component {
    /** The index of its first row. */
    first: number;
    /** The keys of the part numbers its rows have, by supplier. */
    partNumbers: Map<string, Set<string>>;
}

/** Whether a supplier has part numbers for both components, but none for
 *  both: 100n and 10n capacitors, say, that share a part number of another
 *  supplier by mistake. */
function differentParts(a: Component, b: Component): boolean {
    for (const [supplier, used] of a.partNumbers) {
        const others = b.partNumbers.get(supplier);
        if (others && ![...used].some(key => others.has(key))) {
            return true;
        }
    }
    return false;
}

/** The groups of rows to unify, in the order of their first row. */
export function findUnifyGroups(
    members: readonly ListMember[],
    history: Project | null,
    { matchFootprint = true, buildQuantity = 1 } = {}
): UnifyGroup[] {
    const rows: { member: ListMember; row: BomRow }[] = [];
    const sets = new UnionFind();
    const components = new Map<string, Component>();
    const sharing = new Map<
        string,
        { supplier: SupplierId; components: Set<Component>; rows: number[] }
    >();
    for (const member of members) {
        for (const row of member.project.rows) {
            const index = sets.add();
            rows.push({ member, row });
            const key = componentKey(row, matchFootprint);
            let component = components.get(key);
            if (component) {
                sets.union(index, component.first);
            } else {
                component = { first: index, partNumbers: new Map() };
                components.set(key, component);
            }
            for (const [supplier, partNumber] of Object.entries(
                definedPartNumbers(row)
            )) {
                const partKey = partNumberKey(partNumber);
                const used = component.partNumbers.get(supplier) ?? new Set();
                component.partNumbers.set(supplier, used.add(partKey));
                const shared = sharing.get(`${supplier}:${partKey}`) ?? {
                    supplier: supplier as SupplierId,
                    components: new Set(),
                    rows: []
                };
                shared.components.add(component);
                shared.rows.push(index);
                sharing.set(`${supplier}:${partKey}`, shared);
            }
        }
    }
    // Components that share a part number are one, e.g. "10k" and
    // "10k 1%", unless another supplier's part numbers say they are
    // different parts: then the shared one is likely a mistake.
    for (const shared of sharing.values()) {
        const [first, ...others] = [...shared.components];
        for (const [i, other] of others.entries()) {
            for (const earlier of [first!, ...others.slice(0, i)]) {
                if (!differentParts(earlier, other)) {
                    sets.union(other.first, earlier.first);
                }
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
    // The part numbers still shared between groups: those of components
    // told apart (#90).
    const sharedBy = new Map<number, SharedPartNumber[]>();
    for (const { supplier, rows: indexes } of sharing.values()) {
        const roots = new Set(indexes.map(index => sets.find(index)));
        if (roots.size < 2) {
            continue;
        }
        for (const root of roots) {
            const own = indexes.find(index => sets.find(index) === root)!;
            sharedBy.set(root, [
                ...(sharedBy.get(root) ?? []),
                {
                    supplier,
                    partNumber: definedPartNumbers(rows[own]!.row)[supplier]!,
                    rows: indexes
                        .filter(index => sets.find(index) !== root)
                        .map(index => ({
                            bomName: rows[index]!.member.name,
                            reference: rows[index]!.row.reference.trim(),
                            value: tidy(rows[index]!.row.value)
                        }))
                }
            ]);
        }
    }

    const groups: UnifyGroup[] = [];
    for (const [root, indexes] of grouped) {
        const shared = sharedBy.get(root) ?? [];
        if (indexes.length < 2 && shared.length === 0) {
            continue;
        }
        const entries = indexes.map(index => rows[index]!);
        const group = describeGroup(
            entries,
            history,
            suppliers,
            matchFootprint,
            buildQuantity,
            false,
            shared
        );
        if (group) {
            groups.push(group);
        }
    }
    return groups;
}

/**
 * Rows of a BOM whose components have other part numbers in the history
 * (#52), a group each: for a supplier of the BOM, the row's part number
 * and every other one the history has for the component. Only the rows in
 * `rowIds`, or all. Stock and prices are for the row's quantity.
 */
export function findHistoryGroups(
    member: ListMember,
    rowIds: ReadonlySet<string> | null,
    history: Project,
    { matchFootprint = true, buildQuantity = 1 } = {}
): UnifyGroup[] {
    const suppliers = SUPPLIER_IDS.filter(supplier =>
        member.project.suppliers.includes(supplier)
    );
    return member.project.rows.flatMap(row => {
        if (rowIds && !rowIds.has(row.id)) {
            return [];
        }
        const group = describeGroup(
            [{ member, row }],
            history,
            suppliers,
            matchFootprint,
            buildQuantity,
            true
        );
        return group ? [group] : [];
    });
}

/**
 * @param fromHistory offer a supplier's part numbers when the history has
 *   one the rows don't (#52), rather than when the rows differ.
 */
function describeGroup(
    entries: { member: ListMember; row: BomRow }[],
    history: Project | null,
    suppliers: readonly SupplierId[],
    matchFootprint: boolean,
    buildQuantity: number,
    fromHistory = false,
    shared: SharedPartNumber[] = []
): UnifyGroup | null {
    const rows: UnifyRow[] = entries.map(({ member, row }) => ({
        bom: member.path,
        bomName: member.name,
        rowId: row.id,
        reference: row.reference.trim(),
        value: tidy(row.value),
        qty: row.qty * member.perDevice * buildQuantity,
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
        if (
            !fromHistory &&
            !shared.some(one => one.supplier === supplier) &&
            new Set(cells.map(cellKey)).size < 2
        ) {
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
        if (fromHistory && !used.some(candidate => candidate.rows === 0)) {
            continue;
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
        suppliers: choices,
        shared: shared.filter(one => choices[one.supplier])
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
 * the most used Value. A supplier with a part number that another component
 * has too keeps its cells.
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
        // A part number another component has too is likely a mistake,
        // here or there: the cells are kept until one is chosen (#90).
        if (group.shared.some(one => one.supplier === supplier)) {
            suppliers[supplier] = null;
            continue;
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
