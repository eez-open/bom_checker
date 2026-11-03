// Sync KiCad… (GitHub #30): brings changes made in a KiCad project since the
// BOM was imported into the BOM, without losing what was done in the BOM:
// rows and columns added by hand, and values changed in the BOM.
//
// Parts are compared by reference. `source.kicadValues` holds KiCad's values
// at the last import or sync. A value KiCad changed since then is offered
// (ticked); one changed only in the BOM is kept and not listed. Values both
// changed, and every difference in a BOM without those values (imported by
// version 0.4 or older), are offered unticked.

import { suggestMapping, type CsvTable } from "./csv-import";
import {
    partNumberKey,
    type BomRow,
    type ColumnKey,
    type ManualOffer,
    type Project,
    type SupplierId
} from "./model";
import { normalizeCell } from "./part-number";
import { addSupplier, createRow, setCell } from "./project-ops";
import { joinReferences, splitReferences } from "./references";
import { SUPPLIERS } from "./suppliers";

/** A BOM column: "value", "footprint", "pn:<supplier>" or "custom:<id>". */
export type SyncKey = string;

/** KiCad's BOM for the variant, by reference. */
export interface KicadBom {
    /** Values of each part, for the columns KiCad's table has. */
    parts: Map<string, Record<SyncKey, string>>;
    /** The references of the KiCad row each part is in. */
    groupOf: Map<string, string[]>;
    keys: SyncKey[];
}

export type SyncChange =
    | {
          kind: "column";
          id: string;
          supplier: SupplierId;
          /** Parts with a part number in KiCad. */
          count: number;
      }
    | {
          kind: "added";
          id: string;
          references: string[];
          /** Value · Footprint in KiCad. */
          description: string;
      }
    | {
          kind: "removed";
          id: string;
          rowId: string;
          references: string[];
          rowReferences: string;
      }
    | {
          kind: "changed";
          id: string;
          rowId: string;
          references: string[];
          key: SyncKey;
          label: string;
          from: string;
          to: string;
          /** Changed in the BOM too, or unknown which side changed. */
          bothChanged: boolean;
      };

export interface SyncPlan {
    changes: SyncChange[];
    /** Changes ticked at first. */
    selected: string[];
}

/** Reads KiCad's BOM table (as the import dialog shows it). */
export function readKicadBom(project: Project, table: CsvTable): KicadBom {
    const mapping = suggestMapping(table.headers);
    let referenceIndex = -1;
    const keys: (SyncKey | null)[] = mapping.map((target, index) => {
        const header = table.headers[index] ?? "";
        switch (target.kind) {
            case "base":
                if (target.field === "reference") {
                    referenceIndex = index;
                }
                return target.field === "value" || target.field === "footprint"
                    ? target.field
                    : null;
            case "partNumber":
                return `pn:${target.supplier}`;
            default: {
                const column = project.customColumns.find(
                    c => c.name === header
                );
                return column ? `custom:${column.id}` : null;
            }
        }
    });

    const parts = new Map<string, Record<SyncKey, string>>();
    const groupOf = new Map<string, string[]>();
    for (const cells of table.rows) {
        const references = splitReferences(cells[referenceIndex] ?? "");
        const values: Record<SyncKey, string> = {};
        keys.forEach((key, index) => {
            if (key) {
                values[key] = normalizeCell(cells[index]);
            }
        });
        for (const reference of references) {
            parts.set(reference, values);
            groupOf.set(reference, references);
        }
    }
    return {
        parts,
        groupOf,
        keys: keys.filter((key): key is SyncKey => key !== null)
    };
}

function columnKey(key: SyncKey): ColumnKey | null {
    if (key === "value" || key === "footprint") {
        return { kind: "base", field: key };
    }
    const [kind, id] = key.split(":") as [string, string];
    if (kind === "pn") {
        return { kind: "partNumber", supplier: id as SupplierId };
    }
    return kind === "custom" ? { kind: "custom", id } : null;
}

/** Whether the project has the column. */
function hasColumn(project: Project, key: SyncKey): boolean {
    const column = columnKey(key);
    switch (column?.kind) {
        case "base":
            return true;
        case "partNumber":
            return project.suppliers.includes(column.supplier);
        case "custom":
            return project.customColumns.some(c => c.id === column.id);
        default:
            return false;
    }
}

function bomValue(row: BomRow, key: SyncKey): string {
    const column = columnKey(key);
    switch (column?.kind) {
        case "base":
            return normalizeCell(String(row[column.field]));
        case "partNumber":
            return normalizeCell(row.partNumbers[column.supplier]);
        case "custom":
            return normalizeCell(String(row.custom[column.id] ?? ""));
        default:
            return "";
    }
}

function label(project: Project, key: SyncKey): string {
    const column = columnKey(key);
    switch (column?.kind) {
        case "base":
            return column.field === "value" ? "Value" : "Footprint";
        case "partNumber":
            return SUPPLIERS[column.supplier].name;
        case "custom":
            return (
                project.customColumns.find(c => c.id === column.id)?.name ?? key
            );
        default:
            return key;
    }
}

/** The columns compared with KiCad: those KiCad has, and those it had at
 *  the last import or sync (e.g. a field since emptied everywhere). */
function trackedKeys(project: Project, kicad: KicadBom): SyncKey[] {
    const snapshot = project.source.kicadValues ?? {};
    const keys = new Set(kicad.keys);
    for (const values of Object.values(snapshot)) {
        Object.keys(values).forEach(key => keys.add(key));
    }
    return [...keys].filter(key => hasColumn(project, key));
}

/** The first BOM row of each reference. */
function bomReferences(project: Project): Map<string, BomRow> {
    const rows = new Map<string, BomRow>();
    for (const row of project.rows) {
        for (const reference of splitReferences(row.reference)) {
            if (!rows.has(reference)) {
                rows.set(reference, row);
            }
        }
    }
    return rows;
}

export function planSync(project: Project, kicad: KicadBom): SyncPlan {
    const snapshot = project.source.kicadValues;
    const bom = bomReferences(project);
    const changes: SyncChange[] = [];
    const selected: string[] = [];
    const add = (change: SyncChange, ticked: boolean) => {
        changes.push(change);
        if (ticked) {
            selected.push(change.id);
        }
    };

    // Supplier part numbers KiCad has but the BOM has no column for.
    for (const key of kicad.keys) {
        const column = columnKey(key);
        if (column?.kind !== "partNumber" || hasColumn(project, key)) {
            continue;
        }
        const count = [...kicad.parts.values()].filter(v => v[key]).length;
        if (count > 0) {
            add(
                {
                    kind: "column",
                    id: `column:${column.supplier}`,
                    supplier: column.supplier,
                    count
                },
                true
            );
        }
    }

    // Parts added in KiCad, by KiCad row.
    const added = new Map<string, string[]>();
    for (const reference of kicad.parts.keys()) {
        if (!bom.has(reference)) {
            const group = joinReferences(kicad.groupOf.get(reference)!);
            added.set(group, [...(added.get(group) ?? []), reference]);
        }
    }
    for (const references of added.values()) {
        const values = kicad.parts.get(references[0]!)!;
        add(
            {
                kind: "added",
                id: `added:${joinReferences(references)}`,
                references: splitReferences(joinReferences(references)),
                description: [values.value, values.footprint]
                    .filter(Boolean)
                    .join(" · ")
            },
            true
        );
    }

    // Parts gone from KiCad's BOM, by BOM row. Without KiCad's earlier
    // values, they may also be parts added by hand: offered unticked.
    const removed = new Map<BomRow, string[]>();
    for (const [reference, row] of bom) {
        if (kicad.parts.has(reference)) {
            continue;
        }
        if (snapshot && !(reference in snapshot)) {
            continue; // added in the BOM, not from KiCad
        }
        removed.set(row, [...(removed.get(row) ?? []), reference]);
    }
    for (const [row, references] of removed) {
        add(
            {
                kind: "removed",
                id: `removed:${row.id}`,
                rowId: row.id,
                references,
                rowReferences: row.reference
            },
            snapshot !== undefined
        );
    }

    // Changed values, by BOM row, column and new value.
    const changed = new Map<string, Extract<SyncChange, { kind: "changed" }>>();
    const keys = trackedKeys(project, kicad);
    for (const [reference, row] of bom) {
        const values = kicad.parts.get(reference);
        if (!values) {
            continue;
        }
        for (const key of keys) {
            const ours = bomValue(row, key);
            const theirs = values[key] ?? "";
            if (ours === theirs) {
                continue;
            }
            const base = snapshot?.[reference]?.[key];
            if (base !== undefined && base === theirs) {
                continue; // changed in the BOM only
            }
            const bothChanged = base === undefined || base !== ours;
            const id = `changed:${row.id}:${key}:${theirs}`;
            const change = changed.get(id) ?? {
                kind: "changed" as const,
                id,
                rowId: row.id,
                references: [],
                key,
                label: label(project, key),
                from: ours,
                to: theirs,
                bothChanged: false
            };
            change.references.push(reference);
            change.bothChanged ||= bothChanged;
            changed.set(id, change);
        }
    }
    for (const change of changed.values()) {
        add(change, !change.bothChanged);
    }
    return { changes, selected };
}

/**
 * Applies the chosen changes as one new project. A row whose references
 * now differ in a value is split; references of removed parts leave their
 * row, which goes when it has none left; added parts join the row of their
 * KiCad row-mates when it matches, or get a new row. Afterwards KiCad's
 * current values are the new reference point.
 */
export function applySync(
    project: Project,
    kicad: KicadBom,
    plan: SyncPlan,
    selected: ReadonlySet<string>
): Project {
    const chosen = plan.changes.filter(change => selected.has(change.id));
    let next = project;
    for (const change of chosen) {
        if (change.kind === "column") {
            next = addSupplier(next, change.supplier);
        }
    }

    // New values per reference.
    const overrides = new Map<string, Record<SyncKey, string>>();
    const override = (reference: string, key: SyncKey, value: string) =>
        overrides.set(reference, {
            ...overrides.get(reference),
            [key]: value
        });
    const removed = new Set<string>();
    for (const change of chosen) {
        if (change.kind === "changed") {
            change.references.forEach(r => override(r, change.key, change.to));
        } else if (change.kind === "removed") {
            change.references.forEach(r => removed.add(r));
        } else if (change.kind === "column") {
            const key = `pn:${change.supplier}`;
            for (const reference of bomReferences(next).keys()) {
                const value = kicad.parts.get(reference)?.[key];
                if (value) {
                    override(reference, key, value);
                }
            }
        }
    }

    // Rows: removed references leave, rows split where values now differ.
    const edits: { rowId: string; key: SyncKey; value: string }[] = [];
    const rows: BomRow[] = [];
    for (const row of next.rows) {
        const references = splitReferences(row.reference);
        const kept = references.filter(r => !removed.has(r));
        if (references.length > 0 && kept.length === 0) {
            continue;
        }
        const parts = new Map<string, string[]>();
        for (const reference of kept) {
            const signature = JSON.stringify(
                Object.entries(overrides.get(reference) ?? {}).sort()
            );
            parts.set(signature, [...(parts.get(signature) ?? []), reference]);
        }
        if (parts.size <= 1 && kept.length === references.length) {
            rows.push(row);
            for (const [key, value] of Object.entries(
                overrides.get(kept[0] ?? "") ?? {}
            )) {
                edits.push({ rowId: row.id, key, value });
            }
            continue;
        }
        let first = true;
        for (const part of parts.values()) {
            const qty =
                row.qty === references.length || !first ? part.length : row.qty;
            const split: BomRow = {
                ...row,
                id: first ? row.id : crypto.randomUUID(),
                reference: joinReferences(part),
                qty
            };
            rows.push(split);
            for (const [key, value] of Object.entries(
                overrides.get(part[0]!) ?? {}
            )) {
                edits.push({ rowId: split.id, key, value });
            }
            first = false;
        }
    }
    next = { ...next, rows };

    // Added parts.
    const keys = trackedKeys(next, kicad);
    for (const change of chosen) {
        if (change.kind !== "added") {
            continue;
        }
        const values = kicad.parts.get(change.references[0]!)!;
        const mates = new Set(kicad.groupOf.get(change.references[0]!));
        const mateRows = next.rows.filter(row =>
            splitReferences(row.reference).some(r => mates.has(r))
        );
        const target = mateRows.length === 1 ? mateRows[0]! : undefined;
        if (
            target &&
            keys.every(k => bomValue(target, k) === (values[k] ?? ""))
        ) {
            const references = splitReferences(target.reference);
            const joined: BomRow = {
                ...target,
                reference: joinReferences([
                    ...references,
                    ...change.references
                ]),
                qty:
                    target.qty === references.length
                        ? references.length + change.references.length
                        : target.qty
            };
            next = {
                ...next,
                rows: next.rows.map(row => (row === target ? joined : row))
            };
            continue;
        }
        const row = createRow({
            reference: joinReferences(change.references),
            qty: change.references.length
        });
        next = { ...next, rows: [...next.rows, row] };
        for (const key of keys) {
            if (values[key]) {
                edits.push({ rowId: row.id, key, value: values[key] });
            }
        }
    }

    for (const { rowId, key, value } of edits) {
        const column = columnKey(key);
        if (column) {
            next = setCell(next, rowId, column, value);
        }
    }

    // KiCad's values now are the reference point for the next sync.
    const kicadValues: Record<string, Record<string, string>> = {};
    for (const [reference, values] of kicad.parts) {
        kicadValues[reference] = Object.fromEntries(
            keys.map(key => [key, values[key] ?? ""])
        );
    }
    return { ...next, source: { ...next.source, kicadValues } };
}

/** BOM rows to join into one (#55). */
export interface RowJoin {
    /** The same for the same rows, whatever their ids. */
    id: string;
    /** In BOM order; the first one becomes the joined row. */
    rowIds: string[];
    /** All references of the rows, in natural order. */
    references: string[];
    /** Value · Footprint. */
    description: string;
}

/**
 * Rows to join (#55). When KiCad renumbers its parts (Annotate Schematic),
 * a sync compares other parts under the old references, so the parts of
 * one KiCad row can end up in several BOM rows. Rows are joined when all
 * their references are in the same row of KiCad's BOM and they have the
 * same Value, Footprint and part numbers. A value in another column, or
 * for a supplier without an API, that only some of them have goes to the
 * joined row; rows with different such values stay apart.
 */
export function planJoins(project: Project, kicad: KicadBom): RowJoin[] {
    const same = new Map<string, BomRow[]>();
    for (const row of project.rows) {
        const references = splitReferences(row.reference);
        const group = kicad.groupOf.get(references[0] ?? "");
        if (!group || !references.every(r => group.includes(r))) {
            continue;
        }
        const key = JSON.stringify([
            joinReferences(group),
            normalizeCell(row.value),
            normalizeCell(row.footprint),
            ...project.suppliers.map(s =>
                partNumberKey(row.partNumbers[s] ?? "")
            )
        ]);
        same.set(key, [...(same.get(key) ?? []), row]);
    }
    const joins: RowJoin[] = [];
    for (const [key, rows] of same) {
        const clusters: BomRow[][] = [];
        for (const row of rows) {
            const cluster = clusters.find(c =>
                c.every(other => canJoin(row, other))
            );
            if (cluster) {
                cluster.push(row);
            } else {
                clusters.push([row]);
            }
        }
        clusters.forEach((cluster, index) => {
            if (cluster.length < 2) {
                return;
            }
            const first = cluster[0]!;
            joins.push({
                id: `join:${key}:${index}`,
                rowIds: cluster.map(row => row.id),
                references: splitReferences(
                    joinReferences(
                        new Set(
                            cluster.flatMap(row =>
                                splitReferences(row.reference)
                            )
                        )
                    )
                ),
                description: [first.value, first.footprint]
                    .map(normalizeCell)
                    .filter(Boolean)
                    .join(" · ")
            });
        });
    }
    return joins;
}

/** Whether two rows have no different values in the columns that don't
 *  decide whether they're the same component. */
function canJoin(a: BomRow, b: BomRow): boolean {
    const agree = <T>(
        x: Record<string, T> | undefined,
        y: Record<string, T> | undefined,
        equal: (p: T, q: T) => boolean
    ) =>
        Object.entries(x ?? {}).every(
            ([key, value]) => y?.[key] === undefined || equal(value, y[key])
        );
    const sameOffer = (p: ManualOffer, q: ManualOffer) =>
        JSON.stringify(Object.entries(p).sort()) ===
        JSON.stringify(Object.entries(q).sort());
    return (
        agree(a.custom, b.custom, (p, q) => p === q) &&
        agree(a.manual, b.manual, sameOffer)
    );
}

/** Joins each group of rows into its first row: the references and the
 *  quantities together, with the values any of them has. */
export function joinRows(project: Project, joins: readonly RowJoin[]): Project {
    const joinOf = new Map<string, RowJoin>();
    for (const join of joins) {
        join.rowIds.forEach(id => joinOf.set(id, join));
    }
    if (joinOf.size === 0) {
        return project;
    }
    const byId = new Map(project.rows.map(row => [row.id, row]));
    const rows: BomRow[] = [];
    for (const row of project.rows) {
        const join = joinOf.get(row.id);
        if (!join) {
            rows.push(row);
            continue;
        }
        if (join.rowIds[0] !== row.id) {
            continue;
        }
        const members = join.rowIds.map(id => byId.get(id)!);
        // Values any of them has; they don't differ.
        const custom: BomRow["custom"] = {};
        const manual: NonNullable<BomRow["manual"]> = {};
        for (const member of [...members].reverse()) {
            Object.assign(custom, member.custom);
            Object.assign(manual, member.manual);
        }
        rows.push({
            ...row,
            reference: joinReferences(join.references),
            // Decimal quantities mustn't gain rounding errors.
            qty: Number(
                members.reduce((sum, member) => sum + member.qty, 0).toFixed(9)
            ),
            custom,
            ...(members.some(member => member.manual) ? { manual } : {})
        });
    }
    return { ...project, rows };
}

/** KiCad's values right after an import: the project's own values. */
export function importedKicadValues(
    project: Project
): Record<string, Record<string, string>> {
    const keys: SyncKey[] = [
        "value",
        "footprint",
        ...project.suppliers.map(s => `pn:${s}`),
        ...project.customColumns.map(c => `custom:${c.id}`)
    ];
    const values: Record<string, Record<string, string>> = {};
    for (const row of project.rows) {
        for (const reference of splitReferences(row.reference)) {
            values[reference] = Object.fromEntries(
                keys.map(key => [key, bomValue(row, key)])
            );
        }
    }
    return values;
}

/** After Update KiCad… wrote `changes`, KiCad has those values: they're
 *  the reference point for the next sync. */
export function markWrittenToKicad(
    project: Project,
    changes: readonly { references: string; key: SyncKey; to: string }[]
): Project {
    const before = project.source.kicadValues;
    if (!before || changes.length === 0) {
        return project;
    }
    const kicadValues = { ...before };
    for (const { references, key, to } of changes) {
        for (const reference of splitReferences(references)) {
            kicadValues[reference] = { ...kicadValues[reference], [key]: to };
        }
    }
    return { ...project, source: { ...project.source, kicadValues } };
}
