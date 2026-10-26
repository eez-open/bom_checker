import { useState } from "react";
import { MAX_BUILD_QUANTITY } from "../shared/model";
import { setBuildQuantity } from "../shared/project-ops";
import {
    addRow,
    deleteSelectedRows,
    editColumns,
    importCsv,
    importKicad,
    newDocument,
    openCollect,
    openExport,
    openDocument,
    openSettings,
    saveDocument
} from "./commands";
import { useDocument } from "./store/document";
import { useUi } from "./store/ui";

const BUILD_QUANTITY_HELP =
    "How many units (e.g. boards) to build. Qty of every row is multiplied by it for order quantities, prices and availability.";

/** Applied on Enter or when leaving the field, as one undo step. */
function BuildQuantityInput({ value }: { value: number }) {
    const [text, setText] = useState(String(value));
    const parsed = Number(text.trim());
    const valid =
        /^\d+$/.test(text.trim()) &&
        parsed >= 1 &&
        parsed <= MAX_BUILD_QUANTITY;

    const apply = () => {
        if (valid) {
            useDocument
                .getState()
                .edit(project => setBuildQuantity(project, parsed));
        } else {
            setText(String(value));
        }
    };

    return (
        <input
            className="number build-quantity"
            inputMode="numeric"
            value={text}
            aria-invalid={!valid}
            onChange={event => setText(event.target.value)}
            onBlur={apply}
            onKeyDown={event => {
                if (event.key === "Enter") {
                    apply();
                } else if (event.key === "Escape") {
                    setText(String(value));
                }
            }}
        />
    );
}

export function Toolbar() {
    const selectedCount = useUi(state => state.selectedRowIds.length);
    const buildQuantity = useDocument(state => state.project.buildQuantity);

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
            <button
                type="button"
                title="Ctrl+K"
                onClick={() => void importKicad()}
            >
                Import KiCad…
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
            <span className="toolbar-separator" />
            <label className="toolbar-field" title={BUILD_QUANTITY_HELP}>
                Build qty
                {/* A new key resets the text after undo, redo or opening a
                    BOM. */}
                <BuildQuantityInput key={buildQuantity} value={buildQuantity} />
            </label>
            <span className="toolbar-separator" />
            <button type="button" className="primary" onClick={openCollect}>
                Collect…
            </button>
            <button type="button" title="Ctrl+E" onClick={openExport}>
                Export…
            </button>
            <span className="toolbar-spacer" />
            <button type="button" title="Ctrl+," onClick={openSettings}>
                Settings…
            </button>
        </div>
    );
}
