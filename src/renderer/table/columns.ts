import type {
    CellClassParams,
    ColDef,
    ColGroupDef,
    ValueGetterParams
} from "ag-grid-community";
import { lastCollectedAt } from "../../shared/collection";
import type { ColumnGroup } from "../../shared/ipc";
import { availabilityText, statusText } from "../../shared/line-text";
import {
    BASE_COLUMNS,
    type BomRow,
    type ColumnKey,
    type Lifecycle,
    type Project,
    type SupplierId
} from "../../shared/model";
import { hasAlternatives } from "../../shared/part-number";
import {
    BASE_CURRENCY,
    bestSupplier,
    supplierLine,
    type SupplierLine
} from "../../shared/pricing";
import { SUPPLIERS } from "../../shared/suppliers";
import { ChooseItemCell } from "./ChooseItemCell";
import { PartNumberCell, resultFor, type TableContext } from "./PartNumberCell";

/** Id of the pinned row with the column totals. */
export const TOTALS_ROW_ID = "totals";
import { describeResult } from "./result-text";
import { SupplierGroupHeader } from "./SupplierGroupHeader";

export interface TableColumns {
    columnDefs: (ColDef<BomRow> | ColGroupDef<BomRow>)[];
    /** Maps a grid column id to the BOM column it edits. */
    keys: Map<string, ColumnKey>;
}

const ALTERNATIVES_TOOLTIP =
    "Several part numbers in one cell. Keep only one; until then, this " +
    "cell is skipped when collecting supplier data.";

const WIDTHS: Record<string, number> = {
    row: 80,
    reference: 220,
    value: 160,
    qty: 90,
    footprint: 260
};

const LIFECYCLE_CLASS: Record<Lifecycle, string | null> = {
    active: null,
    new: "lifecycle-warning",
    nrnd: "lifecycle-warning",
    eol: "lifecycle-warning",
    "special-order": "lifecycle-warning",
    obsolete: "lifecycle-danger",
    "not-orderable": "lifecycle-danger"
};

const UNIT_PRICE = new Intl.NumberFormat("en", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4
});
const TOTAL_PRICE = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});
const QUANTITY = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });

function context(params: { context: unknown }): TableContext {
    return params.context as TableContext;
}

function lineOf(
    params: { data?: BomRow; context: unknown },
    supplier: SupplierId
): SupplierLine | null {
    const table = context(params);
    return params.data
        ? supplierLine(
              params.data,
              supplier,
              table.getCollected(),
              table.getBuildQuantity()
          )
        : null;
}

/** A total price; when building several units, the price per unit
 *  follows in parentheses: "62.50 (2.50)". */
function formatTotal(params: { value: unknown; context: unknown }): string {
    if (typeof params.value !== "number") {
        return "";
    }
    const build = context(params).getBuildQuantity();
    const total = TOTAL_PRICE.format(params.value);
    return build > 1
        ? `${total} (${TOTAL_PRICE.format(params.value / build)})`
        : total;
}

/** The Total price columns' header tooltip. */
function totalTooltip(name: string, buildQuantity: number): string {
    return buildQuantity > 1
        ? `${name}_Total price (${BASE_CURRENCY}); in parentheses, per unit (÷ ${buildQuantity})`
        : `${name}_Total price (${BASE_CURRENCY})`;
}

function formatQuantity(value: unknown): string {
    return typeof value === "number" ? QUANTITY.format(value) : "";
}

function availabilityClass(line: SupplierLine | null): string | undefined {
    if (!line) {
        return undefined;
    }
    if (line.result.status !== "found") {
        return line.result.status === "ambiguous"
            ? "avail-warning"
            : "avail-danger";
    }
    switch (line.availability?.kind) {
        case "in-stock":
            return "avail-ok";
        case "partial":
            return "avail-warning";
        default:
            return "avail-danger";
    }
}

function partNumberColumn(supplier: SupplierId): ColDef<BomRow, string> {
    return {
        colId: `pn:${supplier}`,
        headerName: SUPPLIERS[supplier].name,
        headerTooltip: `${SUPPLIERS[supplier].name} part number`,
        cellDataType: "text",
        initialWidth: 190,
        valueGetter: params => params.data?.partNumbers[supplier] ?? "",
        cellRenderer: PartNumberCell,
        cellRendererParams: { supplier },
        cellClassRules: {
            "cell-invalid": params => hasAlternatives(params.value),
            "cell-none": params => params.value === "-"
        },
        tooltipValueGetter: params => {
            if (hasAlternatives(params.value)) {
                return ALTERNATIVES_TOOLTIP;
            }
            const result = resultFor(params.context, supplier, params.value);
            return result
                ? describeResult(SUPPLIERS[supplier].name, result)
                : undefined;
        }
    };
}

/** Read-only columns calculated from the collected data. The prefixed
 *  names ("Mouser_Stock Qty") are used in tooltips and exports. */
function dataColumns(
    supplier: SupplierId,
    buildQuantity: number
): ColDef<BomRow>[] {
    const name = SUPPLIERS[supplier].name;
    const column = (
        field: string,
        header: string,
        valueGetter: (line: SupplierLine | null) => unknown,
        options: ColDef<BomRow> = {}
    ): ColDef<BomRow> => ({
        colId: `data:${supplier}:${field}`,
        headerName: header,
        headerTooltip: `${name}_${header}`,
        editable: false,
        valueGetter: (params: ValueGetterParams<BomRow>) =>
            valueGetter(lineOf(params, supplier)) ?? null,
        ...options
    });
    const numeric: ColDef<BomRow> = {
        type: "rightAligned",
        initialWidth: 110,
        valueFormatter: params => formatQuantity(params.value)
    };

    return [
        column(
            "manufacturer",
            "Manufacturer",
            line => line?.offer?.manufacturer,
            {
                columnGroupShow: "open",
                initialWidth: 170
            }
        ),
        column("stockQty", "Stock Qty", line => line?.offer?.stockQty, {
            ...numeric,
            columnGroupShow: "open"
        }),
        column("moq", "MOQ", line => line?.offer?.moq, {
            ...numeric,
            initialWidth: 90,
            columnGroupShow: "open",
            tooltipValueGetter: params => {
                const multiple =
                    lineOf(params, supplier)?.offer?.orderMultiple ?? 1;
                return multiple > 1
                    ? `Sold in multiples of ${multiple}.`
                    : undefined;
            }
        }),
        column("orderQty", "Order Qty", line => line?.orderQty, {
            ...numeric,
            columnGroupShow: "open",
            tooltipValueGetter: params => {
                const build = context(params).getBuildQuantity();
                return build > 1
                    ? `Qty × ${build} (build quantity), raised to the MOQ and rounded up to the order multiple.`
                    : "Qty raised to the MOQ and rounded up to the order multiple.";
            }
        }),
        column("unitPrice", "Unit price", line => line?.unitPrice, {
            type: "rightAligned",
            initialWidth: 110,
            columnGroupShow: "open",
            valueFormatter: params => {
                const line = lineOf(params, supplier);
                if (typeof params.value !== "number" || !line?.offer) {
                    return "";
                }
                const currency = line.inBaseCurrency
                    ? ""
                    : ` ${line.offer.currency}`;
                return UNIT_PRICE.format(params.value) + currency;
            },
            cellClassRules: {
                "cell-warning": params =>
                    lineOf(params, supplier)?.belowFirstBreak === true
            },
            tooltipValueGetter: params => {
                const line = lineOf(params, supplier);
                if (!line?.offer || line.unitPrice === null) {
                    return undefined;
                }
                const kind = {
                    account: "Your account's price",
                    list: "List price",
                    unknown:
                        "The supplier doesn't say whether this is your account's price"
                }[line.offer.priceKind];
                const below = line.belowFirstBreak
                    ? ` The order quantity is below the first price break (${line.offer.priceBreaks[0]?.qty}).`
                    : "";
                return `${kind}, for ${QUANTITY.format(line.orderQty ?? 0)} pcs.${below}`;
            }
        }),
        column("totalPrice", "Total price", line => line?.total, {
            type: "rightAligned",
            initialWidth: 110,
            valueGetter: params => {
                if (params.node?.rowPinned) {
                    const sum = context(params).getTotals().suppliers[supplier];
                    return sum?.priced ? sum.total : null;
                }
                return lineOf(params, supplier)?.total ?? null;
            },
            valueFormatter: formatTotal,
            headerTooltip: totalTooltip(name, buildQuantity),
            tooltipValueGetter: params => {
                if (params.node?.rowPinned) {
                    const { rows, suppliers } = context(params).getTotals();
                    const priced = suppliers[supplier]?.priced ?? 0;
                    return priced === rows
                        ? `Sum of ${name}'s total prices, for all ${rows} rows.`
                        : `Sum of ${name}'s total prices, for ${priced} of ${rows} rows; the others have no price in ${BASE_CURRENCY}.`;
                }
                const line = lineOf(params, supplier);
                return line?.offer && !line.inBaseCurrency
                    ? `Prices are in ${line.offer.currency}; totals are only calculated in ${BASE_CURRENCY}.`
                    : undefined;
            }
        }),
        column("availability", "Availability", availabilityText, {
            initialWidth: 160,
            cellClass: (params: CellClassParams<BomRow>) =>
                availabilityClass(lineOf(params, supplier)),
            // Several items match: a list to choose one from (#15).
            cellRendererSelector: params =>
                lineOf(params, supplier)?.result.status === "ambiguous"
                    ? { component: ChooseItemCell, params: { supplier } }
                    : undefined,
            // Arrow keys and Enter belong to the list while it has focus.
            suppressKeyboardEvent: params =>
                params.event.target instanceof HTMLSelectElement
        }),
        column("status", "Status", line => statusText(line?.offer) || null, {
            initialWidth: 140,
            columnGroupShow: "open",
            cellClass: (params: CellClassParams<BomRow>) => {
                const lifecycle = lineOf(params, supplier)?.offer?.lifecycle;
                return lifecycle
                    ? (LIFECYCLE_CLASS[lifecycle] ?? undefined)
                    : undefined;
            },
            tooltipValueGetter: params =>
                lineOf(params, supplier)?.offer?.lifecycleRaw ?? undefined
        }),
        column("rohs", "RoHS", line => line?.offer?.rohs, {
            initialWidth: 150,
            columnGroupShow: "open"
        })
    ];
}

function bestColumns(project: Project): ColGroupDef<BomRow> {
    const best = (params: { data?: BomRow; context: unknown }) =>
        params.data
            ? bestSupplier(
                  params.data,
                  context(params).getCollected(),
                  project.suppliers,
                  context(params).getPreference(),
                  context(params).getBuildQuantity()
              )
            : null;
    const column = (
        field: string,
        header: string,
        options: ColDef<BomRow>
    ): ColDef<BomRow> => ({
        colId: `best:${field}`,
        headerName: header,
        headerTooltip: `Best_${header}`,
        editable: false,
        ...options
    });
    return {
        groupId: "group:best",
        headerName: "Best price",
        children: [
            column("supplier", "Supplier", {
                initialWidth: 130,
                valueGetter: params => {
                    const choice = best(params);
                    if (choice) {
                        return SUPPLIERS[choice.supplier].name;
                    }
                    const hasData =
                        params.data &&
                        project.suppliers.some(s =>
                            supplierLine(
                                params.data!,
                                s,
                                context(params).getCollected(),
                                context(params).getBuildQuantity()
                            )
                        );
                    return hasData ? "None in stock" : "";
                },
                cellClassRules: {
                    "avail-danger": params => params.value === "None in stock"
                },
                tooltipValueGetter: params =>
                    params.value === "None in stock"
                        ? "No supplier has the whole order quantity in stock at a price in EUR."
                        : undefined
            }),
            column("orderQty", "Order Qty", {
                type: "rightAligned",
                initialWidth: 110,
                valueGetter: params => best(params)?.line.orderQty ?? null,
                valueFormatter: params => formatQuantity(params.value)
            }),
            column("unitPrice", "Unit price", {
                type: "rightAligned",
                initialWidth: 110,
                valueGetter: params => best(params)?.line.unitPrice ?? null,
                valueFormatter: params =>
                    typeof params.value === "number"
                        ? UNIT_PRICE.format(params.value)
                        : ""
            }),
            column("totalPrice", "Total price", {
                type: "rightAligned",
                initialWidth: 110,
                headerTooltip: totalTooltip("Best", project.buildQuantity),
                valueGetter: params => {
                    if (params.node?.rowPinned) {
                        const totals = context(params).getTotals().best;
                        return totals.covered ? totals.total : null;
                    }
                    return best(params)?.line.total ?? null;
                },
                tooltipValueGetter: params => {
                    if (!params.node?.rowPinned) {
                        return undefined;
                    }
                    const { rows, best } = context(params).getTotals();
                    return `Sum of the best prices, for ${best.covered} of ${rows} rows.`;
                },
                valueFormatter: formatTotal
            })
        ]
    };
}

/** Hides or shows all columns of a group. Set on every column, because a
 *  column without `hide` keeps its previous state. */
function hideGroup(
    group: ColGroupDef<BomRow>,
    hide: boolean
): ColGroupDef<BomRow> {
    return {
        ...group,
        children: group.children.map(child => ({ ...child, hide }))
    };
}

/**
 * @param withData suppliers that have collected data; only they get the
 *   calculated columns.
 * @param hidden column groups the user has hidden.
 */
export function buildColumns(
    project: Project,
    withData: readonly SupplierId[],
    hidden: ReadonlySet<ColumnGroup> = new Set()
): TableColumns {
    const keys = new Map<string, ColumnKey>();
    const columnDefs: (ColDef<BomRow> | ColGroupDef<BomRow>)[] = [];

    for (const column of BASE_COLUMNS) {
        const numeric = column.type === "number";
        if (column.field === "row") {
            columnDefs.push({
                colId: "row",
                headerName: column.header,
                type: "rightAligned",
                initialWidth: WIDTHS.row,
                pinned: "left",
                editable: false,
                sortable: false,
                // The row's place in the BOM, also when sorted or filtered.
                valueGetter: params =>
                    params.node?.rowPinned
                        ? null
                        : (params.node?.sourceRowIndex ?? 0) + 1
            });
            continue;
        }
        keys.set(column.field, { kind: "base", field: column.field });
        columnDefs.push({
            colId: column.field,
            field: column.field,
            headerName: column.header,
            type: numeric ? "rightAligned" : undefined,
            cellDataType: numeric ? "number" : "text",
            // Qty may be a decimal, e.g. 0.004 m of tape.
            cellEditorParams: numeric ? { min: 0, precision: 6 } : undefined,
            initialWidth: WIDTHS[column.field],
            // Row, Reference and Value stay in view while scrolling to
            // supplier data.
            pinned:
                column.field === "reference" || column.field === "value"
                    ? "left"
                    : undefined
        });
        if (column.field === "qty" && project.buildQuantity > 1) {
            columnDefs.push({
                colId: "totalQty",
                headerName: "Total Qty",
                headerTooltip: `Qty × ${project.buildQuantity} (build quantity)`,
                type: "rightAligned",
                initialWidth: 100,
                editable: false,
                valueGetter: params =>
                    (params.data?.qty ?? 0) * project.buildQuantity,
                valueFormatter: params => formatQuantity(params.value)
            });
        }
    }

    for (const supplier of project.suppliers) {
        keys.set(`pn:${supplier}`, { kind: "partNumber", supplier });
        const children: ColDef<BomRow>[] = [
            partNumberColumn(supplier) as ColDef<BomRow>
        ];
        if (withData.includes(supplier)) {
            children.push(...dataColumns(supplier, project.buildQuantity));
        }
        columnDefs.push(
            hideGroup(
                {
                    groupId: `group:${supplier}`,
                    headerName: SUPPLIERS[supplier].name,
                    headerGroupComponentParams: {
                        innerHeaderGroupComponent: SupplierGroupHeader,
                        innerHeaderGroupComponentParams: {
                            collectedAt: lastCollectedAt(
                                project.collected,
                                supplier
                            )
                        }
                    },
                    openByDefault: true,
                    children
                },
                hidden.has(supplier)
            )
        );
    }

    if (withData.length >= 2) {
        columnDefs.push(hideGroup(bestColumns(project), hidden.has("best")));
    }

    for (const column of project.customColumns) {
        const colId = `custom:${column.id}`;
        const numeric = column.type === "number";
        keys.set(colId, { kind: "custom", id: column.id });
        columnDefs.push({
            colId,
            headerName: column.name,
            type: numeric ? "rightAligned" : undefined,
            cellDataType: numeric ? "number" : "text",
            initialWidth: 150,
            valueGetter: params => params.data?.custom[column.id] ?? null
        });
    }

    return { columnDefs, keys };
}
