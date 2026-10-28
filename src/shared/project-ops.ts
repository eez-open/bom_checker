// Editing operations on a Project. None of them mutates its input: each
// returns a new Project, or the same object when nothing changed, so the UI
// can skip no-op undo steps and keep the "unsaved changes" state accurate.

import {
    BASE_COLUMNS,
    MAX_BUILD_QUANTITY,
    PROJECT_SCHEMA_VERSION,
    partNumberKey,
    type BomRow,
    type ColumnKey,
    type ColumnType,
    type CustomColumn,
    type CustomValue,
    type Project,
    type ManualField,
    type ManualOffer,
    type ManualSupplier,
    type SupplierId
} from "./model";
import { ALL_SUPPLIERS, sortSuppliers } from "./suppliers";

export function createProject(): Project {
    return {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        source: { kind: "manual" },
        suppliers: [],
        customColumns: [],
        manualSuppliers: [],
        rows: [],
        buildQuantity: 1,
        collected: { results: {}, runs: {} }
    };
}

export function createRow(fields: Partial<Omit<BomRow, "id">> = {}): BomRow {
    return {
        id: crypto.randomUUID(),
        reference: "",
        value: "",
        qty: 1,
        footprint: "",
        partNumbers: {},
        custom: {},
        ...fields
    };
}

export function addRow(project: Project, row: BomRow = createRow()): Project {
    return { ...project, rows: [...project.rows, row] };
}

export function deleteRows(project: Project, ids: Iterable<string>): Project {
    const remove = new Set(ids);
    const rows = project.rows.filter(row => !remove.has(row.id));
    return rows.length === project.rows.length ? project : { ...project, rows };
}

/**
 * Sets one cell from a raw edited value. Text is trimmed; an empty part
 * number or custom value removes the entry. Values that can't be converted
 * (e.g. "abc" for Qty) leave the cell unchanged.
 */
export function setCell(
    project: Project,
    rowId: string,
    key: ColumnKey,
    raw: unknown
): Project {
    const index = project.rows.findIndex(row => row.id === rowId);
    const row = project.rows[index];
    if (!row) {
        return project;
    }
    const updated = updateRow(project, row, key, raw);
    if (updated === row) {
        return project;
    }
    const rows = project.rows.slice();
    rows[index] = updated;
    return { ...project, rows };
}

function updateRow(
    project: Project,
    row: BomRow,
    key: ColumnKey,
    raw: unknown
): BomRow {
    switch (key.kind) {
        case "base": {
            if (key.field === "qty") {
                const qty = toQuantity(raw);
                return qty === undefined || qty === row.qty
                    ? row
                    : { ...row, qty };
            }
            const text = toText(raw);
            return text === row[key.field]
                ? row
                : { ...row, [key.field]: text };
        }
        case "partNumber": {
            const partNumbers = withEntry(
                row.partNumbers,
                key.supplier,
                toText(raw)
            );
            return partNumbers === row.partNumbers
                ? row
                : { ...row, partNumbers };
        }
        case "custom": {
            const column = project.customColumns.find(c => c.id === key.id);
            if (!column) {
                return row;
            }
            const value =
                column.type === "number" ? toOptionalNumber(raw) : toText(raw);
            if (value === undefined) {
                return row;
            }
            const custom = withEntry(row.custom, key.id, value);
            return custom === row.custom ? row : { ...row, custom };
        }
        case "manual": {
            if (!project.manualSuppliers.some(s => s.id === key.supplier)) {
                return row;
            }
            const value =
                key.field === "partNumber"
                    ? toText(raw)
                    : toOptionalNumber(raw);
            if (
                value === undefined ||
                (typeof value === "number" &&
                    (value < 0 || (key.field === "moq" && value === 0)))
            ) {
                return row;
            }
            const offer = row.manual?.[key.supplier] ?? {};
            if (
                value === ""
                    ? !(key.field in offer)
                    : offer[key.field] === value
            ) {
                return row;
            }
            const next: ManualOffer = { ...offer };
            if (value === "") {
                delete next[key.field];
            } else {
                (next as Record<ManualField, string | number>)[key.field] =
                    value;
            }
            const manual = { ...row.manual };
            if (Object.keys(next).length === 0) {
                delete manual[key.supplier];
            } else {
                manual[key.supplier] = next;
            }
            return { ...row, manual };
        }
    }
}

/** Sets or (for "") removes an entry; returns the same object if unchanged. */
function withEntry<T extends Partial<Record<string, CustomValue>>>(
    record: T,
    key: keyof T & string,
    value: CustomValue
): T {
    if (value === "") {
        if (!(key in record)) {
            return record;
        }
        const copy = { ...record };
        delete copy[key];
        return copy;
    }
    return record[key] === value ? record : { ...record, [key]: value };
}

function toText(raw: unknown): string {
    if (typeof raw === "string") {
        return raw.trim();
    }
    return typeof raw === "number" && Number.isFinite(raw) ? String(raw) : "";
}

function toQuantity(raw: unknown): number | undefined {
    if (typeof raw === "number") {
        return Number.isFinite(raw) && raw >= 0 ? raw : undefined;
    }
    return parseQuantity(toText(raw));
}

/**
 * A Qty as typed or imported: a whole or decimal number, with "." or ","
 * as the decimal separator ("0.004", "0,004"), for parts used in fractions
 * of their unit, such as metres of tape. Undefined if it isn't one.
 */
export function parseQuantity(text: string): number | undefined {
    const match = /^(\d+)(?:[.,](\d+))?$/.exec(text.trim());
    return match ? Number(`${match[1]}.${match[2] ?? "0"}`) : undefined;
}

/** A number, "" for "no value", or undefined when the input isn't a number. */
function toOptionalNumber(raw: unknown): number | "" | undefined {
    if (typeof raw === "number") {
        return Number.isFinite(raw) ? raw : undefined;
    }
    const text = toText(raw);
    if (text === "") {
        return "";
    }
    const value = Number(text);
    return Number.isFinite(value) ? value : undefined;
}

// --- Supplier part-number columns -------------------------------------------

export function addSupplier(project: Project, supplier: SupplierId): Project {
    return project.suppliers.includes(supplier)
        ? project
        : {
              ...project,
              suppliers: sortSuppliers([...project.suppliers, supplier])
          };
}

/** Replaces a part number (compared by `partNumberKey`) in every row that
 *  uses it, e.g. after choosing one of several matching supplier items. */
export function replacePartNumber(
    project: Project,
    supplier: SupplierId,
    key: string,
    partNumber: string
): Project {
    const value = partNumber.trim();
    let changed = false;
    const rows = project.rows.map(row => {
        const current = row.partNumbers[supplier];
        if (
            current === undefined ||
            partNumberKey(current) !== key ||
            current === value
        ) {
            return row;
        }
        changed = true;
        return {
            ...row,
            partNumbers: { ...row.partNumbers, [supplier]: value }
        };
    });
    return changed ? { ...project, rows } : project;
}

export function removeSupplier(
    project: Project,
    supplier: SupplierId
): Project {
    if (!project.suppliers.includes(supplier)) {
        return project;
    }
    return {
        ...project,
        suppliers: project.suppliers.filter(id => id !== supplier),
        rows: project.rows.map(row =>
            supplier in row.partNumbers
                ? {
                      ...row,
                      partNumbers: withEntry(row.partNumbers, supplier, "")
                  }
                : row
        )
    };
}

export function supplierHasValues(
    project: Project,
    supplier: SupplierId
): boolean {
    return project.rows.some(row => supplier in row.partNumbers);
}

// --- Custom columns ----------------------------------------------------------

/**
 * Returns why `name` can't be used for a custom column, or null if it can.
 * Supplier names and their prefixes ("Mouser_…", "Best_…") are reserved for
 * the columns filled in by data collection.
 */
export function validateColumnName(
    project: Project,
    name: string,
    exceptId?: string
): string | null {
    const trimmed = name.trim();
    if (trimmed === "") {
        return "Enter a column name.";
    }
    const lower = trimmed.toLowerCase();
    const reserved = [
        ...BASE_COLUMNS.map(column => column.header),
        ...ALL_SUPPLIERS.map(supplier => supplier.name)
    ];
    if (reserved.some(other => other.toLowerCase() === lower)) {
        return `"${trimmed}" is a built-in column.`;
    }
    const manual = project.manualSuppliers.filter(s => s.id !== exceptId);
    const prefix = [
        ...ALL_SUPPLIERS.map(s => s.name),
        ...manual.map(s => s.name),
        "Best"
    ]
        .map(name => `${name}_`)
        .find(prefix => lower.startsWith(prefix.toLowerCase()));
    if (prefix) {
        return `Names starting with "${prefix}" are reserved for supplier data.`;
    }
    const duplicate =
        project.customColumns.some(
            column =>
                column.id !== exceptId && column.name.toLowerCase() === lower
        ) || manual.some(supplier => supplier.name.toLowerCase() === lower);
    return duplicate ? `A column named "${trimmed}" already exists.` : null;
}

/** `name`, or `name (2)`, `name (3)`… if it's taken or reserved. */
export function uniqueColumnName(project: Project, name: string): string {
    const base = name.trim() || "Column";
    for (let n = 1; ; n++) {
        const candidate = n === 1 ? base : `${base} (${n})`;
        if (validateColumnName(project, candidate) === null) {
            return candidate;
        }
    }
}

export function addCustomColumn(
    project: Project,
    name: string,
    type: ColumnType
): { project: Project; column: CustomColumn } {
    assertValidName(project, name);
    const column: CustomColumn = {
        id: crypto.randomUUID(),
        name: name.trim(),
        type
    };
    return {
        project: {
            ...project,
            customColumns: [...project.customColumns, column]
        },
        column
    };
}

export function renameCustomColumn(
    project: Project,
    id: string,
    name: string
): Project {
    const column = project.customColumns.find(c => c.id === id);
    if (!column || column.name === name.trim()) {
        return project;
    }
    assertValidName(project, name, id);
    return {
        ...project,
        customColumns: project.customColumns.map(c =>
            c.id === id ? { ...c, name: name.trim() } : c
        )
    };
}

export function deleteCustomColumn(project: Project, id: string): Project {
    if (!project.customColumns.some(column => column.id === id)) {
        return project;
    }
    return {
        ...project,
        customColumns: project.customColumns.filter(c => c.id !== id),
        rows: project.rows.map(row =>
            id in row.custom
                ? { ...row, custom: withEntry(row.custom, id, "") }
                : row
        )
    };
}

export function customColumnHasValues(project: Project, id: string): boolean {
    return project.rows.some(row => id in row.custom);
}

// --- Suppliers without an API ----------------------------------------------

/** Adds a supplier without an API; its name follows the column-name rules,
 *  since it heads its columns ("Shop_Unit price" in exports). */
export function addManualSupplier(
    project: Project,
    name: string
): { project: Project; supplier: ManualSupplier } {
    assertValidName(project, name);
    const supplier: ManualSupplier = {
        id: crypto.randomUUID(),
        name: name.trim()
    };
    return {
        project: {
            ...project,
            manualSuppliers: [...project.manualSuppliers, supplier]
        },
        supplier
    };
}

export function renameManualSupplier(
    project: Project,
    id: string,
    name: string
): Project {
    const supplier = project.manualSuppliers.find(s => s.id === id);
    if (!supplier || supplier.name === name.trim()) {
        return project;
    }
    assertValidName(project, name, id);
    return {
        ...project,
        manualSuppliers: project.manualSuppliers.map(s =>
            s.id === id ? { ...s, name: name.trim() } : s
        )
    };
}

/** Removes a supplier without an API with everything typed for it. */
export function deleteManualSupplier(project: Project, id: string): Project {
    if (!project.manualSuppliers.some(s => s.id === id)) {
        return project;
    }
    return {
        ...project,
        manualSuppliers: project.manualSuppliers.filter(s => s.id !== id),
        rows: project.rows.map(row => {
            if (!row.manual || !(id in row.manual)) {
                return row;
            }
            const manual = { ...row.manual };
            delete manual[id];
            return { ...row, manual };
        })
    };
}

export function manualSupplierHasValues(project: Project, id: string): boolean {
    return project.rows.some(row => row.manual?.[id] !== undefined);
}

/** Suppliers without an API that have a price in some row. */
export function manualSuppliersWithPrices(project: Project): ManualSupplier[] {
    return project.manualSuppliers.filter(supplier =>
        project.rows.some(
            row => row.manual?.[supplier.id]?.unitPrice !== undefined
        )
    );
}

function assertValidName(project: Project, name: string, exceptId?: string) {
    const error = validateColumnName(project, name, exceptId);
    if (error) {
        throw new Error(error);
    }
}

// --- Helpers -----------------------------------------------------------------

/** Number of designators in a "C1,C2, C3" style reference list. */
export function countReferences(reference: string): number {
    return reference.split(/[\s,]+/).filter(Boolean).length;
}

export function setBuildQuantity(project: Project, quantity: number): Project {
    if (
        !Number.isInteger(quantity) ||
        quantity < 1 ||
        quantity > MAX_BUILD_QUANTITY
    ) {
        throw new Error(`Invalid build quantity: ${quantity}`);
    }
    return quantity === project.buildQuantity
        ? project
        : { ...project, buildQuantity: quantity };
}

/** Suppliers of the BOM that have collected data. */
export function suppliersWithData(project: Project): SupplierId[] {
    return project.suppliers.filter(
        s => Object.keys(project.collected.results[s] ?? {}).length > 0
    );
}

/** Total number of parts (sum of Qty). */
