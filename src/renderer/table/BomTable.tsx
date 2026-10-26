import {
    AllCommunityModule,
    ModuleRegistry,
    themeQuartz,
    type CellEditRequestEvent,
    type EditableCallbackParams,
    type GridApi,
    type GridReadyEvent,
    type SelectionChangedEvent
} from "ag-grid-community";
import { AgGridReact } from "ag-grid-react";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type {
    BomRow,
    ColumnKey,
    Project,
    SupplierId
} from "../../shared/model";
import { bomTotals, supplierTotal } from "../../shared/pricing";
import { createRow } from "../../shared/project-ops";
import { buildColumns, TOTALS_ROW_ID } from "./columns";
import type { TableContext, TableTotals } from "./PartNumberCell";

// AG Grid is used only inside this folder (see "BOM checker architecture.md").

ModuleRegistry.registerModules([AllCommunityModule]);

const theme = themeQuartz.withParams({
    fontSize: 13,
    spacing: 6,
    headerFontWeight: 600
});

const ROW_SELECTION = {
    mode: "multiRow",
    checkboxes: true,
    headerCheckbox: true,
    enableClickSelection: false
} as const;

const SELECTION_COLUMN = { pinned: "left" } as const;

const DEFAULT_COLUMN = {
    // The pinned Total row isn't a BOM row.
    editable: (params: EditableCallbackParams<BomRow>) =>
        !params.node.rowPinned,
    resizable: true,
    sortable: true
};

interface BomTableProps {
    project: Project;
    /** Preferred supplier order, for best price ties. */
    preference: readonly SupplierId[];
    onCellEdit: (rowId: string, key: ColumnKey, value: unknown) => void;
    onSelectionChange: (rowIds: string[]) => void;
    /** A newly added row whose Reference cell should start editing. */
    editRowId: string | null;
    onEditStarted: () => void;
}

function EmptyTable() {
    return (
        <div className="empty-table">
            No components yet. Add rows by hand, import a CSV file or open a
            KiCad project.
        </div>
    );
}

export function BomTable({
    project,
    preference,
    onCellEdit,
    onSelectionChange,
    editRowId,
    onEditStarted
}: BomTableProps) {
    const apiRef = useRef<GridApi<BomRow> | null>(null);
    // Cells read collected data and the supplier preference through the
    // grid context, which stays the same object; changes are shown by
    // refreshing the cells.
    const collected = useRef(project.collected);
    const preferenceRef = useRef(preference);
    const totals = useMemo<TableTotals>(
        () => ({
            rows: project.rows.length,
            suppliers: Object.fromEntries(
                project.suppliers.map(s => [s, supplierTotal(project, s)])
            ),
            best: bomTotals(project, preference)
        }),
        [project, preference]
    );
    const totalsRef = useRef(totals);
    const context = useMemo<TableContext>(
        () => ({
            getCollected: () => collected.current,
            getPreference: () => preferenceRef.current,
            getTotals: () => totalsRef.current
        }),
        []
    );

    useEffect(() => {
        collected.current = project.collected;
        preferenceRef.current = preference;
        apiRef.current?.refreshCells({ force: true });
    }, [project.collected, preference]);

    useEffect(() => {
        totalsRef.current = totals;
        const api = apiRef.current;
        const totalsRow = api?.getPinnedTopRow(0);
        if (api && totalsRow) {
            api.refreshCells({ rowNodes: [totalsRow], force: true });
        }
    }, [totals]);

    // Suppliers with collected data get the calculated columns.
    const withData = project.suppliers
        .filter(s => Object.keys(project.collected.results[s] ?? {}).length > 0)
        .join(",");

    const { columnDefs, keys } = useMemo(
        () =>
            buildColumns(
                project,
                withData ? (withData.split(",") as SupplierId[]) : []
            ),
        // Columns change only when suppliers, custom columns or the
        // suppliers with data do.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [project.suppliers, project.customColumns, withData]
    );

    // Shown once there are prices to add up.
    const parts = project.rows.reduce((sum, row) => sum + row.qty, 0);
    const pinnedRows = useMemo(
        () =>
            withData
                ? [
                      {
                          ...createRow({ reference: "Total", qty: parts }),
                          id: TOTALS_ROW_ID
                      }
                  ]
                : [],
        [withData, parts]
    );

    const startPendingEdit = useCallback(() => {
        const api = apiRef.current;
        const node = editRowId ? api?.getRowNode(editRowId) : undefined;
        if (!api || node?.rowIndex == null) {
            return;
        }
        api.ensureIndexVisible(node.rowIndex);
        api.setFocusedCell(node.rowIndex, "reference");
        api.startEditingCell({ rowIndex: node.rowIndex, colKey: "reference" });
        onEditStarted();
    }, [editRowId, onEditStarted]);

    return (
        <AgGridReact<BomRow>
            theme={theme}
            rowData={project.rows}
            columnDefs={columnDefs}
            defaultColDef={DEFAULT_COLUMN}
            getRowId={params => params.data.id}
            pinnedTopRowData={pinnedRows}
            getRowClass={params =>
                params.node.rowPinned ? "totals-row" : undefined
            }
            rowSelection={ROW_SELECTION}
            selectionColumnDef={SELECTION_COLUMN}
            readOnlyEdit
            singleClickEdit={false}
            stopEditingWhenCellsLoseFocus
            tooltipShowDelay={300}
            suppressColumnVirtualisation
            context={context}
            noRowsOverlayComponent={EmptyTable}
            onGridReady={(event: GridReadyEvent<BomRow>) =>
                (apiRef.current = event.api)
            }
            onRowDataUpdated={startPendingEdit}
            onCellEditRequest={(event: CellEditRequestEvent<BomRow>) => {
                const key = keys.get(event.column.getColId());
                if (key && event.data) {
                    onCellEdit(event.data.id, key, event.newValue);
                }
            }}
            onSelectionChanged={(event: SelectionChangedEvent<BomRow>) =>
                onSelectionChange(
                    event.api.getSelectedRows().map(row => row.id)
                )
            }
        />
    );
}
