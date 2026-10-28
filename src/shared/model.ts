// BOM data model shared by the main process and the UI. The project file
// format (project-file.ts) stores exactly these types.

export const SUPPLIER_IDS = ["digikey", "mouser", "tme", "lcsc"] as const;
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
    /** May be a decimal, e.g. 0.004 (metres of tape). */
    qty: number;
    footprint: string;
    /** Trimmed supplier part numbers. A missing entry means "none". */
    partNumbers: Partial<Record<SupplierId, string>>;
    /** Custom column values, keyed by `CustomColumn.id`. */
    custom: Record<string, CustomValue>;
    /** What was typed for suppliers without an API, keyed by
     *  `ManualSupplier.id`. */
    manual?: Record<string, ManualOffer>;
}

/** A supplier without an API (#20), e.g. a local shop or an enclosure
 *  maker: its part numbers, prices and stock are typed into the table. */
export interface ManualSupplier {
    id: string;
    name: string;
}

export type ManualField = "partNumber" | "unitPrice" | "stock" | "moq";

/** One row's data for a supplier without an API. Prices are in EUR; no
 *  stock means it's always available, e.g. made to order. */
export interface ManualOffer {
    partNumber?: string;
    unitPrice?: number;
    stock?: number;
    moq?: number;
}

export interface ProjectSource {
    kind: "manual" | "csv" | "kicad";
    /** File the BOM was imported from. */
    path?: string;
    /** KiCad design variant. */
    variant?: string;
    /** ISO 8601 time of the import. */
    importedAt?: string;
    /**
     * KiCad's values at the last import or sync, by reference and BOM
     * column ("value", "footprint", "pn:mouser", "custom:<id>"). Sync
     * KiCad… compares them with the project and the BOM to tell changes
     * made in KiCad from changes made in the BOM.
     */
    kicadValues?: Record<string, Record<string, string>>;
}

export const PROJECT_SCHEMA_VERSION = 6;

export const MAX_BUILD_QUANTITY = 1_000_000;

export interface Project {
    schemaVersion: typeof PROJECT_SCHEMA_VERSION;
    source: ProjectSource;
    /** Suppliers that have a part-number column, in `SUPPLIER_IDS` order. */
    suppliers: SupplierId[];
    customColumns: CustomColumn[];
    /** Suppliers without an API, in the order they were added. */
    manualSuppliers: ManualSupplier[];
    rows: BomRow[];
    /** How many units (e.g. boards) to build: every row's Qty is multiplied
     *  by it for order quantities, prices and availability. */
    buildQuantity: number;
    /** Data collected from suppliers. Not part of the undo history: undo
     *  and redo keep the latest collected data. */
    collected: CollectedData;
}

// --- Collected supplier data --------------------------------------------------

export type Lifecycle =
    | "active"
    | "new"
    | "nrnd"
    | "eol"
    | "special-order"
    | "obsolete"
    | "not-orderable";

export interface PriceBreak {
    qty: number;
    /** In `SupplierOffer.currency`. */
    unitPrice: number;
}

/** One orderable item (a specific packaging) as reported by a supplier. */
export interface SupplierOffer {
    supplierPartNumber: string;
    manufacturer: string;
    manufacturerPartNumber: string;
    description: string;
    packaging?: string;
    stockQty: number;
    moq: number;
    /** 1 when the supplier doesn't report one. */
    orderMultiple: number;
    /** Ascending by quantity. */
    priceBreaks: PriceBreak[];
    /** "account": the user's own prices; "list": public prices;
     *  "unknown": the supplier doesn't say. */
    priceKind: "account" | "list" | "unknown";
    /** ISO 4217 code, as reported by the supplier. */
    currency: string;
    lifecycle: Lifecycle | null;
    /** The supplier's own status text, shown in tooltips. */
    lifecycleRaw: string | null;
    rohs: string | null;
    productUrl?: string;
    datasheetUrl?: string;
    /** Caveats worth showing, e.g. "Prices include VAT". */
    notes?: string[];
}

export type LookupOutcome =
    | {
          status: "found";
          offer: SupplierOffer;
          /** "mpn": the cell held a manufacturer part number. */
          matchedBy: "supplierPartNumber" | "mpn";
      }
    | { status: "notFound" }
    | { status: "ambiguous"; candidates: SupplierOffer[] }
    | { status: "error"; message: string };

export type LookupResult = LookupOutcome & {
    runId: string;
    fetchedAt: string;
};

export interface CollectionRun {
    id: string;
    startedAt: string;
    endedAt?: string;
    state: "running" | "complete" | "interrupted";
    /** Why an interrupted run stopped, e.g. "Daily request limit reached". */
    reason?: string;
}

export interface CollectedData {
    /** By supplier, then by `partNumberKey()` of the part number. */
    results: Partial<Record<SupplierId, Record<string, LookupResult>>>;
    /** The latest run per supplier; "Continue" resumes it. */
    runs: Partial<Record<SupplierId, CollectionRun>>;
}

/** Results are stored per part number, not per row: a part number used in
 *  several rows is looked up once, and editing a cell picks up whatever was
 *  collected for its new value. */
export function partNumberKey(partNumber: string): string {
    return partNumber.trim().toUpperCase();
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
    | { kind: "custom"; id: string }
    | { kind: "manual"; supplier: string; field: ManualField };
