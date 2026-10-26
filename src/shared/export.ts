// What an export contains ("BOM checker architecture.md", 11): which
// columns and rows, built from the same calculations as the table. Main
// turns the sheets into an .xlsx, .ods or .csv file.

import { z } from "zod";
import { formatDateTime, lastCollectedAt } from "./collection";
import { availabilityText, statusText } from "./line-text";
import {
    SUPPLIER_IDS,
    type BomRow,
    type Project,
    type SupplierId
} from "./model";
import { isPartNumberDefined } from "./part-number";
import {
    BASE_CURRENCY,
    bestSupplier,
    supplierLine,
    type SupplierLine
} from "./pricing";
import { SUPPLIERS } from "./suppliers";

export const EXPORT_FORMATS = ["xlsx", "ods", "csv"] as const;
export type ExportFormat = (typeof EXPORT_FORMATS)[number];

const supplierId = z.enum(SUPPLIER_IDS);

export const rowFilterSchema = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("all") }),
    z.object({ kind: z.literal("has-part-number"), supplier: supplierId }),
    z.object({ kind: z.literal("best-is"), supplier: supplierId }),
    z.object({ kind: z.literal("not-available") })
]);

export const exportSelectionSchema = z.object({
    /** Suppliers whose part-number and data columns are included. */
    suppliers: z.array(supplierId),
    /** The Best price columns. */
    best: z.boolean(),
    /** The user's own columns. */
    custom: z.boolean(),
    rows: rowFilterSchema
});

export const exportPresetSchema = z.object({
    name: z.string().min(1).max(100),
    selection: exportSelectionSchema
});

export type RowFilter = z.infer<typeof rowFilterSchema>;
export type ExportSelection = z.infer<typeof exportSelectionSchema>;
export type ExportPreset = z.infer<typeof exportPresetSchema>;

export type ExportCell = string | number | null;

export interface ExportSheet {
    name: string;
    /** The first row holds the headers. */
    rows: ExportCell[][];
    /** Spreadsheet number format per column index, e.g. "0.00". */
    numberFormats: Record<number, string>;
    /** Column widths in characters. */
    widths: number[];
}

/** Presets for the suppliers in this BOM; the scope's examples are "all
 *  Mouser data" and "where Mouser offers the best price". */
export function builtInPresets(project: Project): ExportPreset[] {
    return [
        {
            name: "All data",
            selection: {
                suppliers: [...project.suppliers],
                best: true,
                custom: true,
                rows: { kind: "all" }
            }
        },
        ...project.suppliers.flatMap((supplier): ExportPreset[] => {
            const name = SUPPLIERS[supplier].name;
            return [
                {
                    name: `All ${name} data`,
                    selection: {
                        suppliers: [supplier],
                        best: false,
                        custom: false,
                        rows: { kind: "has-part-number", supplier }
                    }
                },
                {
                    name: `Best price from ${name}`,
                    selection: {
                        suppliers: [supplier],
                        best: true,
                        custom: false,
                        rows: { kind: "best-is", supplier }
                    }
                }
            ];
        }),
        {
            name: "Not available anywhere",
            selection: {
                suppliers: [...project.suppliers],
                best: false,
                custom: false,
                rows: { kind: "not-available" }
            }
        }
    ];
}

/** A plain description of a row filter, for the dialog and the Info sheet. */
export function describeRowFilter(filter: RowFilter): string {
    switch (filter.kind) {
        case "all":
            return "All rows";
        case "has-part-number":
            return `Rows with a ${SUPPLIERS[filter.supplier].name} part number`;
        case "best-is":
            return `Rows where ${SUPPLIERS[filter.supplier].name} has the best price`;
        case "not-available":
            return "Rows with part numbers that no supplier can deliver";
    }
}

interface Column {
    header: string;
    width: number;
    format?: string;
    value: (row: BomRow, index: number) => ExportCell;
}

const QUANTITY_FORMAT = "0";
const UNIT_PRICE_FORMAT = "0.0000";
const TOTAL_FORMAT = "0.00";

function columns(
    project: Project,
    preference: readonly SupplierId[],
    selection: ExportSelection
): Column[] {
    const { collected } = project;
    const line = (row: BomRow, supplier: SupplierId) =>
        supplierLine(row, supplier, collected);
    const best = (row: BomRow) =>
        bestSupplier(row, collected, project.suppliers, preference);
    const unitPrice = (l: SupplierLine | null): ExportCell => {
        if (!l?.offer || l.unitPrice === null) {
            return null;
        }
        // Prices in another currency are written as text, so they can't be
        // mistaken for EUR.
        return l.inBaseCurrency
            ? l.unitPrice
            : `${l.unitPrice} ${l.offer.currency}`;
    };

    const result: Column[] = [
        {
            header: "Row",
            width: 6,
            format: QUANTITY_FORMAT,
            value: (_row, index) => index + 1
        },
        { header: "Reference", width: 30, value: row => row.reference },
        { header: "Value", width: 18, value: row => row.value },
        {
            header: "Qty",
            width: 6,
            format: QUANTITY_FORMAT,
            value: row => row.qty
        },
        { header: "Footprint", width: 30, value: row => row.footprint }
    ];

    for (const supplier of project.suppliers.filter(s =>
        selection.suppliers.includes(s)
    )) {
        const name = SUPPLIERS[supplier].name;
        result.push(
            {
                header: name,
                width: 22,
                value: row => row.partNumbers[supplier] ?? ""
            },
            {
                header: `${name}_Manufacturer`,
                width: 22,
                value: row => line(row, supplier)?.offer?.manufacturer ?? null
            },
            {
                header: `${name}_Stock Qty`,
                width: 12,
                format: QUANTITY_FORMAT,
                value: row => line(row, supplier)?.offer?.stockQty ?? null
            },
            {
                header: `${name}_MOQ`,
                width: 8,
                format: QUANTITY_FORMAT,
                value: row => line(row, supplier)?.offer?.moq ?? null
            },
            {
                header: `${name}_Order Qty`,
                width: 10,
                format: QUANTITY_FORMAT,
                value: row => line(row, supplier)?.orderQty ?? null
            },
            {
                header: `${name}_Unit price`,
                width: 12,
                format: UNIT_PRICE_FORMAT,
                value: row => unitPrice(line(row, supplier))
            },
            {
                header: `${name}_Total price`,
                width: 12,
                format: TOTAL_FORMAT,
                value: row => line(row, supplier)?.total ?? null
            },
            {
                header: `${name}_Availability`,
                width: 16,
                value: row => availabilityText(line(row, supplier)) || null
            },
            {
                header: `${name}_Status`,
                width: 16,
                value: row => statusText(line(row, supplier)?.offer) || null
            },
            {
                header: `${name}_RoHS`,
                width: 18,
                value: row => line(row, supplier)?.offer?.rohs ?? null
            }
        );
    }

    if (selection.best) {
        result.push(
            {
                header: "Best_Supplier",
                width: 12,
                value: row => {
                    const b = best(row);
                    return b ? SUPPLIERS[b.supplier].name : null;
                }
            },
            {
                header: "Best_Order Qty",
                width: 10,
                format: QUANTITY_FORMAT,
                value: row => best(row)?.line.orderQty ?? null
            },
            {
                header: "Best_Unit price",
                width: 12,
                format: UNIT_PRICE_FORMAT,
                value: row => best(row)?.line.unitPrice ?? null
            },
            {
                header: "Best_Total price",
                width: 12,
                format: TOTAL_FORMAT,
                value: row => best(row)?.line.total ?? null
            }
        );
    }

    if (selection.custom) {
        for (const column of project.customColumns) {
            result.push({
                header: column.name,
                width: 18,
                value: row => row.custom[column.id] ?? null
            });
        }
    }
    return result;
}

function matches(
    project: Project,
    preference: readonly SupplierId[],
    row: BomRow,
    filter: RowFilter
): boolean {
    switch (filter.kind) {
        case "all":
            return true;
        case "has-part-number":
            return isPartNumberDefined(row.partNumbers[filter.supplier]);
        case "best-is":
            return (
                bestSupplier(
                    row,
                    project.collected,
                    project.suppliers,
                    preference
                )?.supplier === filter.supplier
            );
        case "not-available":
            return (
                project.suppliers.some(s =>
                    isPartNumberDefined(row.partNumbers[s])
                ) &&
                !bestSupplier(
                    row,
                    project.collected,
                    project.suppliers,
                    preference
                )
            );
    }
}

/** The BOM sheet: headers, then one line per matching row. */
export function buildBomSheet(
    project: Project,
    preference: readonly SupplierId[],
    selection: ExportSelection
): ExportSheet {
    const included = columns(project, preference, selection);
    const rows = project.rows
        .map((row, index) => ({ row, index }))
        .filter(({ row }) => matches(project, preference, row, selection.rows))
        .map(({ row, index }) =>
            included.map(column => column.value(row, index))
        );
    return {
        name: "BOM",
        rows: [included.map(column => column.header), ...rows],
        numberFormats: Object.fromEntries(
            included.flatMap((column, index) =>
                column.format ? [[index, column.format]] : []
            )
        ),
        widths: included.map(column => column.width)
    };
}

export interface InfoOptions {
    documentName: string;
    exportedAt: string;
    presetName: string | null;
    selection: ExportSelection;
    preference: readonly SupplierId[];
}

/** An Info sheet saying what the export contains and how prices were
 *  chosen (xlsx and ods only). */
export function buildInfoSheet(
    project: Project,
    bom: ExportSheet,
    options: InfoOptions
): ExportSheet {
    const { documentName, exportedAt, presetName, selection, preference } =
        options;
    const sum = (header: string): number => {
        const index = bom.rows[0]!.indexOf(header);
        return index < 0
            ? 0
            : bom.rows
                  .slice(1)
                  .reduce<number>(
                      (total, row) =>
                          total +
                          (typeof row[index] === "number" ? row[index] : 0),
                      0
                  );
    };
    const rows: ExportCell[][] = [
        ["EEZ BOM checker export"],
        [],
        ["BOM", documentName],
        ["Source", project.source.path ?? "Created in EEZ BOM checker"]
    ];
    if (project.source.variant) {
        rows.push(["KiCad variant", project.source.variant]);
    }
    rows.push(
        ["Exported", formatDateTime(exportedAt)],
        ["Filter", presetName ?? "Custom"],
        ["Rows", describeRowFilter(selection.rows)],
        ["Exported rows", bom.rows.length - 1],
        [],
        [
            "Prices",
            `In ${BASE_CURRENCY}. Order Qty is Qty raised to the MOQ and rounded up to the order multiple; the unit price is the price break for that quantity.`
        ],
        [
            "Best price",
            "The cheapest total among suppliers that have the whole order quantity in stock; equal totals go to the preferred supplier."
        ],
        [
            "Preferred suppliers",
            preference.map(s => SUPPLIERS[s].name).join(", ")
        ],
        []
    );
    for (const supplier of project.suppliers) {
        const run = project.collected.runs[supplier];
        const collectedAt = lastCollectedAt(project.collected, supplier);
        const name = SUPPLIERS[supplier].name;
        rows.push([
            `${name} data`,
            collectedAt
                ? `Collected ${formatDateTime(collectedAt)}${!run || run.state === "complete" ? "" : ` (${run.state}${run.reason ? `: ${run.reason}` : ""})`}`
                : "Not collected"
        ]);
        if (selection.suppliers.includes(supplier)) {
            rows.push([
                `${name}_Total price (${BASE_CURRENCY})`,
                sum(`${name}_Total price`)
            ]);
        }
    }
    if (selection.best) {
        rows.push([
            `Best price total (${BASE_CURRENCY})`,
            sum("Best_Total price")
        ]);
    }
    return { name: "Info", rows, numberFormats: {}, widths: [28, 90] };
}
