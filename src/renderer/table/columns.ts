import type {
    CellClassParams,
    ColDef,
    ColGroupDef,
    IErrorValidationParams,
    ValueGetterParams
} from "ag-grid-community";
import { lastCollectedAt } from "../../shared/collection";
import {
    availabilityText,
    bestSupplierText,
    OTHER_PACKAGING,
    statusText
} from "../../shared/line-text";
import {
    BASE_COLUMNS,
    MAX_MANUAL_PRICE_BREAKS,
    type BomRow,
    type ColumnKey,
    type Lifecycle,
    type Project,
    type ManualField,
    type ManualSupplier,
    type SupplierId
} from "../../shared/model";
import type { Numbers } from "../../shared/numbers";
import { hasAlternatives } from "../../shared/part-number";
import { manualSuppliersWithPrices } from "../../shared/project-ops";
import { duplicateReferences, quantityMismatch } from "../../shared/references";
import {
    anyInStock,
    BASE_CURRENCY,
    bestSupplier,
    hasSupplierData,
    manualLine,
    manualPriceBreaks,
    supplierLine,
    type SupplierLine
} from "../../shared/pricing";
import { SUPPLIERS, supplierName } from "../../shared/suppliers";
import { ChooseItemCell } from "./ChooseItemCell";
import { CopyCell } from "./CopyCell";
import { PartNumberCell, resultFor, type TableContext } from "./PartNumberCell";
import { PriceBreaksEditor } from "./PriceBreaksEditor";

/** Id of the pinned row with the column totals. */
export const TOTALS_ROW_ID = "totals";
import { describeResult } from "./result-text";
import type { TableGroup } from "../store/ui";
import { BestGroupHeader } from "./BestGroupHeader";
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

/** Number cells are edited as text, so "0,5" works as well as "0.5"
 *  whatever the number format (#37); setCell reads the text. */
const NUMBER_EDITOR: ColDef<BomRow> = {
    cellEditor: "agTextCellEditor",
    valueParser: params => params.newValue as unknown
};

function context(params: { context: unknown }): TableContext {
    return params.context as TableContext;
}

/** How numbers look (#37). */
function numbers(params: { context: unknown }): Numbers {
    return context(params).getNumbers();
}

/** A BOM row's Qty that isn't its number of references (#58); not for
 *  the Total row. */
function mismatchOf(params: {
    data?: BomRow;
    node?: { rowPinned?: unknown } | null;
}): string | null {
    return params.data && !params.node?.rowPinned
        ? quantityMismatch(params.data)
        : null;
}

/** A reference that another row has too (#58). */
function duplicateOf(params: {
    data?: BomRow;
    context: unknown;
}): string | undefined {
    return params.data
        ? context(params).getReferenceProblems().get(params.data.id)
        : undefined;
}

/**
 * Each part is in one row only, and Qty is the number of references
 * (#58): a reference another row has can't be typed in, and rows that
 * have one anyway (e.g. imported) are red. Rows whose Qty differs from
 * their number of references are amber.
 */
const REFERENCE_CHECKS: Record<"reference" | "qty", ColDef<BomRow>> = {
    reference: {
        cellEditorParams: {
            getValidationErrors: ({
                value,
                cellEditorParams: { data, context: table }
            }: IErrorValidationParams<BomRow, string, TableContext>) => {
                const rows = table
                    .getRows()
                    .map(row =>
                        row.id === data.id
                            ? { ...row, reference: value ?? "" }
                            : row
                    );
                const problem = duplicateReferences(rows).get(data.id);
                const message = problem
                    ? `${problem} A part can be in one row only.`
                    : null;
                // The grid shows it only to the mouse pointer.
                table.onEditError(message);
                return message ? [message] : null;
            }
        },
        cellClassRules: {
            "cell-invalid": params => duplicateOf(params) !== undefined,
            "cell-warning": params =>
                duplicateOf(params) === undefined && mismatchOf(params) !== null
        },
        tooltipValueGetter: params =>
            duplicateOf(params) ?? mismatchOf(params) ?? undefined
    },
    qty: {
        cellClassRules: {
            "cell-warning": params => mismatchOf(params) !== null
        },
        tooltipValueGetter: params => mismatchOf(params) ?? undefined
    }
};

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
    const { money } = numbers(params);
    const total = money(params.value);
    return build > 1 ? `${total} (${money(params.value / build)})` : total;
}

/** The Total price columns' header tooltip. */
function totalTooltip(name: string, buildQuantity: number): string {
    return buildQuantity > 1
        ? `${name}_Total price (${BASE_CURRENCY}); in parentheses, per unit (÷ ${buildQuantity})`
        : `${name}_Total price (${BASE_CURRENCY})`;
}

function formatQuantity(params: { value: unknown; context: unknown }): string {
    return typeof params.value === "number"
        ? numbers(params).quantity(params.value)
        : "";
}

function formatUnitPrice(params: { value: unknown; context: unknown }): string {
    return typeof params.value === "number"
        ? numbers(params).unitPrice(params.value)
        : "";
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
                ? describeResult(
                      SUPPLIERS[supplier].name,
                      result,
                      numbers(params)
                  )
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
        valueGetter: (line: SupplierLine | null, numbers: Numbers) => unknown,
        options: ColDef<BomRow> = {}
    ): ColDef<BomRow> => ({
        colId: `data:${supplier}:${field}`,
        headerName: header,
        headerTooltip: `${name}_${header}`,
        editable: false,
        valueGetter: (params: ValueGetterParams<BomRow>) =>
            valueGetter(lineOf(params, supplier), numbers(params)) ?? null,
        ...options
    });
    const numeric: ColDef<BomRow> = {
        type: "rightAligned",
        initialWidth: 110,
        valueFormatter: formatQuantity
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
                return numbers(params).unitPrice(params.value) + currency;
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
                return `${kind}, for ${numbers(params).quantity(line.orderQty ?? 0)} pcs.${below}`;
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
                    ? `Prices are in ${line.offer.currency || "a currency the supplier didn't name"}; totals are only calculated in ${BASE_CURRENCY}.`
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
                params.event.target instanceof HTMLSelectElement,
            // Stock in other packagings of the product, if any.
            tooltipValueGetter: params => {
                const notes = (
                    lineOf(params, supplier)?.offer?.notes ?? []
                ).filter(note => note.startsWith(OTHER_PACKAGING));
                return notes.length > 0 ? notes.join("\n") : undefined;
            }
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

/** The Best price supplier of a row without one (#74). */
const NONE_IN_STOCK = "None in stock";
const NO_BEST_PRICE = "No best price";

function bestColumns(project: Project): ColGroupDef<BomRow> {
    const best = (params: { data?: BomRow; context: unknown }) =>
        params.data
            ? bestSupplier(
                  params.data,
                  context(params).getCollected(),
                  project.suppliers,
                  context(params).getPreference(),
                  context(params).getBuildQuantity(),
                  project.manualSuppliers
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
        headerGroupComponentParams: {
            innerHeaderGroupComponent: BestGroupHeader
        },
        children: [
            column("supplier", "Supplier", {
                // Wide enough for "DigiKey (Partial: 1,000)" (#74).
                initialWidth: 190,
                valueGetter: params => {
                    const choice = best(params);
                    if (choice) {
                        return bestSupplierText(
                            supplierName(project, choice.supplier),
                            choice,
                            numbers(params)
                        );
                    }
                    if (!params.data) {
                        return "";
                    }
                    const current = {
                        ...project,
                        collected: context(params).getCollected(),
                        buildQuantity: context(params).getBuildQuantity()
                    };
                    if (!hasSupplierData(params.data, current)) {
                        return "";
                    }
                    // "None in stock" only when no supplier has any (#74).
                    return anyInStock(params.data, current)
                        ? NO_BEST_PRICE
                        : NONE_IN_STOCK;
                },
                cellClassRules: {
                    "avail-warning": params => best(params)?.partial === true,
                    "avail-danger": params =>
                        params.value === NONE_IN_STOCK ||
                        params.value === NO_BEST_PRICE
                },
                tooltipValueGetter: params => {
                    const choice = best(params);
                    if (choice?.partial) {
                        return `No supplier has the whole order quantity in stock; ${supplierName(project, choice.supplier)} has the most. Order Qty, Unit price and Total price are for what it has.`;
                    }
                    switch (params.value) {
                        case NONE_IN_STOCK:
                            return "No supplier has any of it in stock.";
                        case NO_BEST_PRICE:
                            return "Suppliers have some in stock, but none can sell it at a price in EUR yet: an item still to choose, less than their minimum order quantity, without a price, at a price in another currency, or not orderable.";
                        default:
                            return undefined;
                    }
                }
            }),
            column("orderQty", "Order Qty", {
                type: "rightAligned",
                initialWidth: 110,
                valueGetter: params => best(params)?.line.orderQty ?? null,
                valueFormatter: formatQuantity
            }),
            column("unitPrice", "Unit price", {
                type: "rightAligned",
                initialWidth: 110,
                valueGetter: params => best(params)?.line.unitPrice ?? null,
                valueFormatter: formatUnitPrice
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

/**
 * A supplier without an API (#20): its part number, unit price (EUR),
 * stock and MOQ are typed in; order quantity, total and availability are
 * calculated as for the others.
 */
function manualColumns(
    supplier: ManualSupplier,
    buildQuantity: number,
    keys: Map<string, ColumnKey>,
    readOnly: boolean
): ColGroupDef<BomRow> {
    const { id, name } = supplier;
    const lineOfRow = (params: { data?: BomRow; context: unknown }) =>
        params.data
            ? manualLine(
                  params.data,
                  supplier,
                  context(params).getBuildQuantity()
              )
            : null;
    const typed = (
        field: ManualField,
        header: string,
        options: ColDef<BomRow>
    ): ColDef<BomRow> => {
        const colId = `manual:${id}:${field}`;
        keys.set(colId, { kind: "manual", supplier: id, field });
        return {
            colId,
            headerName: header,
            headerTooltip: `${name}_${header} (typed in)`,
            valueGetter: params =>
                params.data?.manual?.[id]?.[field] ??
                (field === "partNumber" ? "" : null),
            ...options
        };
    };
    const calculated = (
        field: string,
        header: string,
        options: ColDef<BomRow>
    ): ColDef<BomRow> => ({
        colId: `manual:${id}:${field}`,
        headerName: header,
        headerTooltip: `${name}_${header}`,
        editable: false,
        ...options
    });
    return {
        groupId: `group:manual:${id}`,
        headerName: name,
        openByDefault: true,
        children: [
            typed("partNumber", name, {
                cellDataType: "text",
                initialWidth: 170,
                cellRenderer: readOnly ? CopyCell : undefined,
                headerTooltip: `${name} part number (typed in; ${name} has no API)`
            }),
            // The price for the order quantity; the editor has the price
            // breaks (#51).
            typed("unitPrice", "Unit price", {
                type: "rightAligned",
                cellDataType: "number",
                initialWidth: 110,
                headerTooltip: `${name}_Unit price in ${BASE_CURRENCY} (typed in, with up to ${MAX_MANUAL_PRICE_BREAKS} lower prices for larger quantities)`,
                valueGetter: params =>
                    params.node?.rowPinned
                        ? null
                        : (lineOfRow(params)?.unitPrice ?? null),
                valueFormatter: formatUnitPrice,
                cellEditor: PriceBreaksEditor,
                cellEditorParams: { supplier: id, name },
                cellEditorPopup: true,
                cellEditorPopupPosition: "under",
                // Tab moves between the editor's fields.
                suppressKeyboardEvent: params =>
                    params.editing && params.event.key === "Tab",
                cellClassRules: {
                    "cell-breaks": params =>
                        !params.node?.rowPinned &&
                        (params.data?.manual?.[id]?.priceBreaks?.length ?? 0) >
                            0
                },
                tooltipValueGetter: params => {
                    const offer = params.data?.manual?.[id];
                    const line = lineOfRow(params);
                    if (!offer?.priceBreaks || !line?.orderQty) {
                        return undefined;
                    }
                    const { quantity, price } = numbers(params);
                    return [
                        ...manualPriceBreaks(offer).map(
                            b =>
                                `${quantity(b.qty)}+: ${price(b.unitPrice)} ${BASE_CURRENCY}`
                        ),
                        `For ${quantity(line.orderQty)} pcs: ${price(line.unitPrice ?? 0)} ${BASE_CURRENCY} each.`
                    ].join("\n");
                }
            }),
            typed("stock", "Stock Qty", {
                type: "rightAligned",
                cellDataType: "number",
                ...NUMBER_EDITOR,
                initialWidth: 110,
                columnGroupShow: "open",
                headerTooltip: `${name}_Stock Qty (typed in; empty means always available)`,
                valueFormatter: formatQuantity
            }),
            typed("moq", "MOQ", {
                type: "rightAligned",
                cellDataType: "number",
                ...NUMBER_EDITOR,
                initialWidth: 90,
                columnGroupShow: "open",
                valueFormatter: formatQuantity
            }),
            // A one-time cost, e.g. a stencil (#53).
            typed("oneTime", "One-time", {
                cellDataType: "boolean",
                initialWidth: 100,
                columnGroupShow: "open",
                headerTooltip: `${name}_One-time: a one-time cost, e.g. a stencil or tooling. Qty isn't multiplied by the build quantity.`,
                valueGetter: params =>
                    params.node?.rowPinned
                        ? null
                        : params.data?.manual?.[id]?.oneTime === true,
                // No checkbox in the Total row.
                cellRendererSelector: params =>
                    params.node.rowPinned
                        ? { component: () => null }
                        : undefined
            }),
            calculated("orderQty", "Order Qty", {
                type: "rightAligned",
                initialWidth: 110,
                columnGroupShow: "open",
                valueGetter: params => lineOfRow(params)?.orderQty ?? null,
                valueFormatter: formatQuantity,
                tooltipValueGetter: params =>
                    params.data?.manual?.[id]?.oneTime &&
                    context(params).getBuildQuantity() > 1
                        ? "One-time: Qty isn't multiplied by the build quantity."
                        : undefined
            }),
            calculated("totalPrice", "Total price", {
                type: "rightAligned",
                initialWidth: 110,
                headerTooltip: totalTooltip(name, buildQuantity),
                valueGetter: params => {
                    if (params.node?.rowPinned) {
                        const sum = context(params).getTotals().manual[id];
                        return sum?.priced ? sum.total : null;
                    }
                    return lineOfRow(params)?.total ?? null;
                },
                valueFormatter: formatTotal
            }),
            calculated("availability", "Availability", {
                initialWidth: 160,
                valueGetter: params =>
                    availabilityText(lineOfRow(params), numbers(params)) ||
                    null,
                cellClass: (params: CellClassParams<BomRow>) =>
                    availabilityClass(lineOfRow(params))
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
 * @param readOnly no cell can be edited, e.g. in a list's Combined BOM:
 *   references aren't checked (#58), as they're by BOM, and Value and
 *   part numbers get copy buttons (#63).
 */
export function buildColumns(
    project: Project,
    withData: readonly SupplierId[],
    hidden: ReadonlySet<TableGroup> = new Set(),
    readOnly = false
): TableColumns {
    const checkReferences = !readOnly;
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
            ...(numeric ? NUMBER_EDITOR : {}),
            valueFormatter: numeric ? formatQuantity : undefined,
            initialWidth: WIDTHS[column.field],
            // The Total row adds up no quantities: they're of different
            // parts (#42).
            valueGetter:
                column.field === "qty"
                    ? params =>
                          params.node?.rowPinned ? null : params.data?.qty
                    : undefined,
            // Row, Reference and Value stay in view while scrolling to
            // supplier data.
            pinned:
                column.field === "reference" || column.field === "value"
                    ? "left"
                    : undefined,
            cellRenderer:
                readOnly && column.field === "value" ? CopyCell : undefined,
            ...(checkReferences &&
            (column.field === "reference" || column.field === "qty")
                ? REFERENCE_CHECKS[column.field]
                : {})
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
                    params.node?.rowPinned || !params.data
                        ? null
                        : params.data.qty * project.buildQuantity,
                valueFormatter: formatQuantity
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

    for (const supplier of project.manualSuppliers) {
        columnDefs.push(
            hideGroup(
                manualColumns(supplier, project.buildQuantity, keys, readOnly),
                hidden.has(`manual:${supplier.id}`)
            )
        );
    }

    // Best price once two suppliers have prices to compare.
    if (withData.length + manualSuppliersWithPrices(project).length >= 2) {
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
            ...(numeric
                ? { ...NUMBER_EDITOR, valueFormatter: formatQuantity }
                : {}),
            initialWidth: 150,
            valueGetter: params => params.data?.custom[column.id] ?? null
        });
    }

    return { columnDefs, keys };
}
