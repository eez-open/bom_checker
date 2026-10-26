// BOM data model shared by the main process and the UI.

export interface BomRow {
    id: string;
    reference: string;
    value: string;
    qty: number;
    footprint: string;
}

export type ColumnType = "text" | "number";

export interface BaseColumn {
    /** Key in `BomRow`, or "row" for the computed row number. */
    field: keyof BomRow | "row";
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
