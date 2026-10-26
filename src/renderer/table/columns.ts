import type { ColDef } from "ag-grid-community";
import {
    BASE_COLUMNS,
    type BomRow,
    type ColumnKey,
    type Project
} from "../../shared/model";
import { hasAlternatives } from "../../shared/part-number";
import { SUPPLIERS } from "../../shared/suppliers";
import { PartNumberCell, resultFor } from "./PartNumberCell";
import { describeResult } from "./result-text";

export interface TableColumns {
    columnDefs: ColDef<BomRow>[];
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

export function buildColumns(project: Project): TableColumns {
    const keys = new Map<string, ColumnKey>();
    const columnDefs: ColDef<BomRow>[] = [];

    for (const column of BASE_COLUMNS) {
        const numeric = column.type === "number";
        if (column.field === "row") {
            columnDefs.push({
                colId: "row",
                headerName: column.header,
                type: "rightAligned",
                width: WIDTHS.row,
                editable: false,
                sortable: false,
                valueGetter: params => (params.node?.rowIndex ?? 0) + 1
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
            cellEditorParams: numeric ? { min: 0, precision: 0 } : undefined,
            width: WIDTHS[column.field]
        });
    }

    for (const supplier of project.suppliers) {
        const colId = `pn:${supplier}`;
        keys.set(colId, { kind: "partNumber", supplier });
        const partNumberColumn: ColDef<BomRow, string> = {
            colId,
            headerName: SUPPLIERS[supplier].name,
            cellDataType: "text",
            width: 190,
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
                const result = resultFor(
                    params.context,
                    supplier,
                    params.value
                );
                return result
                    ? describeResult(SUPPLIERS[supplier].name, result)
                    : undefined;
            }
        };
        columnDefs.push(partNumberColumn);
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
            width: 150,
            valueGetter: params => params.data?.custom[column.id] ?? null
        });
    }

    return { columnDefs, keys };
}
