import {
    AllCommunityModule,
    ModuleRegistry,
    themeQuartz,
    type ColDef
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { BASE_COLUMNS, type BaseColumn, type BomRow } from "../../shared/model";

// AG Grid is used only inside this folder (see "BOM checker architecture.md").

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
    fontSize: 13,
    spacing: 6,
    headerFontWeight: 600
});

function toColumnDef(column: BaseColumn): ColDef<BomRow> {
    const numeric = column.type === "number";
    const type = numeric ? "rightAligned" : undefined;
    const width = numeric ? 90 : undefined;
    if (column.field === "row") {
        return {
            colId: "row",
            headerName: column.header,
            type,
            width,
            valueGetter: params => (params.node?.rowIndex ?? 0) + 1
        };
    }
    return { field: column.field, headerName: column.header, type, width };
}

const columnDefs = BASE_COLUMNS.map(toColumnDef);

function EmptyTable() {
    return (
        <div className="empty-table">
            No components yet. Add rows by hand, import a CSV file or open a
            KiCad project.
        </div>
    );
}

export function BomTable({ rows }: { rows: BomRow[] }) {
    return (
        <AgGridReact<BomRow>
            theme={theme}
            rowData={rows}
            columnDefs={columnDefs}
            getRowId={params => params.data.id}
            noRowsOverlayComponent={EmptyTable}
        />
    );
}
