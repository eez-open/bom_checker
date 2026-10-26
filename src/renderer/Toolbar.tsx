import {
    addRow,
    deleteSelectedRows,
    editColumns,
    importCsv,
    newDocument,
    openDocument,
    saveDocument
} from "./commands";
import { useUi } from "./store/ui";

export function Toolbar() {
    const selectedCount = useUi(state => state.selectedRowIds.length);

    return (
        <div className="toolbar" role="toolbar" aria-label="BOM">
            <button
                type="button"
                title="Ctrl+N"
                onClick={() => void newDocument()}
            >
                New
            </button>
            <button
                type="button"
                title="Ctrl+O"
                onClick={() => void openDocument()}
            >
                Open…
            </button>
            <button
                type="button"
                title="Ctrl+S"
                onClick={() => void saveDocument()}
            >
                Save
            </button>
            <span className="toolbar-separator" />
            <button
                type="button"
                title="Ctrl+I"
                onClick={() => void importCsv()}
            >
                Import CSV…
            </button>
            <span className="toolbar-separator" />
            <button type="button" onClick={addRow}>
                Add row
            </button>
            <button
                type="button"
                onClick={deleteSelectedRows}
                disabled={selectedCount === 0}
            >
                {selectedCount > 1
                    ? `Delete ${selectedCount} rows`
                    : "Delete row"}
            </button>
            <button type="button" onClick={editColumns}>
                Columns…
            </button>
        </div>
    );
}
