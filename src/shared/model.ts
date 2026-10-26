// BOM data model shared by the main process and the UI. The project file
// format (project-file.ts) stores exactly these types.

export const SUPPLIER_IDS = ["digikey", "mouser", "tme"] as const;
export type SupplierId = (typeof SUPPLIER_IDS)[number];

export type ColumnType = "text" | "number";

export interface CustomColumn {
    id: string;
    name: string;
    type: ColumnType;
}

export type CustomValue = string | number;

export interface BomRow {
    id: string;
    reference: string;
    value: string;
    qty: number;
    footprint: string;
    /** Trimmed supplier part numbers. A missing entry means "none". */
    partNumbers: Partial<Record<SupplierId, string>>;
    /** Custom column values, keyed by `CustomColumn.id`. */
    custom: Record<string, CustomValue>;
}

export interface ProjectSource {
    kind: "manual" | "csv" | "kicad";
    /** File the BOM was imported from. */
    path?: string;
    /** KiCad design variant. */
    variant?: string;
    /** ISO 8601 time of the import. */
    importedAt?: string;
}

export const PROJECT_SCHEMA_VERSION = 1;

export interface Project {
    schemaVersion: typeof PROJECT_SCHEMA_VERSION;
    source: ProjectSource;
    /** Suppliers that have a part-number column, in `SUPPLIER_IDS` order. */
    suppliers: SupplierId[];
    customColumns: CustomColumn[];
    rows: BomRow[];
}

/** The editable mandatory columns; "Row" is computed. */
export type BaseField = "reference" | "value" | "qty" | "footprint";

export interface BaseColumn {
    field: BaseField | "row";
    header: string;
    type: ColumnType;
}

/** Mandatory columns every BOM table has (scope: "mandatory fields"). */
export const BASE_COLUMNS: readonly BaseColumn[] = [
    { field: "row", header: "Row", type: "number" },
    { field: "reference", header: "Reference", type: "text" },
    { field: "value", header: "Value", type: "text" },
    { field: "qty", header: "Qty", type: "number" },
    { field: "footprint", header: "Footprint", type: "text" }
];

/** Identifies an editable cell's column. */
export type ColumnKey =
    | { kind: "base"; field: BaseField }
    | { kind: "partNumber"; supplier: SupplierId }
    | { kind: "custom"; id: string };
