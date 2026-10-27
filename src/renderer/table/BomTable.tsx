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
import { lastCollectedAt } from "../../shared/collection";
import type { ColumnGroup } from "../../shared/ipc";
import type {
    BomRow,
    ColumnKey,
    Project,
    SupplierId
} from "../../shared/model";
import { bomTotals, supplierTotal } from "../../shared/pricing";
import {
    createRow,
    suppliersWithData,
    totalQuantity
} from "../../shared/project-ops";
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
    hiddenColumns: readonly ColumnGroup[];
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
    hiddenColumns,
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
    const buildQuantity = useRef(project.buildQuantity);
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
            getBuildQuantity: () => buildQuantity.current,
            getTotals: () => totalsRef.current
        }),
        []
    );

    useEffect(() => {
        collected.current = project.collected;
        preferenceRef.current = preference;
        buildQuantity.current = project.buildQuantity;
        apiRef.current?.refreshCells({ force: true });
    }, [project.collected, preference, project.buildQuantity]);

    // With a build quantity, totals show the price per unit as well: make
    // the Total price columns wide enough for it.
    const autoSizeTotals = useCallback(() => {
        const api = apiRef.current;
        if (!api || buildQuantity.current <= 1) {
            return;
        }
        const totals = (api.getColumns() ?? [])
            .map(column => column.getColId())
            .filter(id => id.endsWith("totalPrice"));
        api.autoSizeColumns(totals);
    }, []);

    useEffect(() => {
        totalsRef.current = totals;
        const api = apiRef.current;
        const totalsRow = api?.getPinnedTopRow(0);
        if (api && totalsRow) {
            api.refreshCells({ rowNodes: [totalsRow], force: true });
        }
    }, [totals]);

    // Suppliers with collected data get the calculated columns.
    const withData = suppliersWithData(project).join(",");
    const hidden = hiddenColumns.join(",");
    const collectedAt = project.suppliers
        .map(s => lastCollectedAt(project.collected, s))
        .join(",");

    const { columnDefs, keys } = useMemo(
        () =>
            buildColumns(
                project,
                withData ? (withData.split(",") as SupplierId[]) : [],
                new Set(hidden.split(",") as ColumnGroup[])
            ),
        // Columns change only when suppliers, custom columns, the
        // suppliers with data, their collection times, the build quantity
        // (Total Qty) or the hidden groups do.
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [
            project.suppliers,
            project.customColumns,
            withData,
            collectedAt,
            project.buildQuantity,
            hidden
        ]
    );

    // Shown once there are prices to add up.
    const parts = totalQuantity(project);
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

    // Also when columns are added, e.g. after collecting.
    useEffect(() => {
        requestAnimationFrame(autoSizeTotals);
    }, [project.buildQuantity, columnDefs, autoSizeTotals]);

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
            onFirstDataRendered={autoSizeTotals}
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
