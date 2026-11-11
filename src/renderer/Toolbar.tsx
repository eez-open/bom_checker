import { useMemo } from "react";
import { MAX_BUILD_QUANTITY } from "../shared/model";
import { setBuildQuantity } from "../shared/project-ops";
import {
    addRow,
    deleteSelectedRows,
    editColumns,
    forgetSelectedData,
    importCsv,
    importKicad,
    newDocument,
    openCollect,
    openExport,
    openDocument,
    openSettings,
    redo,
    saveDocument,
    selectedRowsData,
    syncKicad,
    undo,
    updateKicad
} from "./commands";
import { RedoIcon, UndoIcon } from "./icons";
import { setListQuantities } from "./list-commands";
import { QuantityInput } from "./QuantityInput";
import { useDocument } from "./store/document";
import { useUi } from "./store/ui";
import { COMBINED, useWorkspace } from "./store/workspace";

const BUILD_QUANTITY_HELP =
    "How many units (e.g. boards) to build. Qty of every row is multiplied by it for order quantities, prices and availability.";

const DEVICES_HELP =
    "How many devices to build. Each BOM counts as many times per device as the × next to it in the list says.";

/** A change is one undo step. */
function setBuildQuantityOfBom(quantity: number): void {
    useDocument.getState().edit(project => setBuildQuantity(project, quantity));
}

export function Toolbar() {
    // Only rows of this BOM count (#23).
    const selectedIds = useUi(state => state.selectedRowIds);
    const rows = useDocument(state => state.project.rows);
    const selectedCount = useMemo(() => {
        const ids = new Set(rows.map(row => row.id));
        return selectedIds.filter(id => ids.has(id)).length;
    }, [rows, selectedIds]);
    // Selected rows with collected data (#40).
    const collected = useDocument(state => state.project.collected);
    const forgettable = useMemo(
        () => (selectedIds.length > 0 ? selectedRowsData().rows : 0),
        // eslint-disable-next-line react-hooks/exhaustive-deps
        [rows, collected, selectedIds]
    );
    const buildQuantity = useDocument(state => state.project.buildQuantity);
    const open = useDocument(state => state.open);
    // E.g. a list's Combined BOM: it can be collected and exported only.
    const editable = useDocument(state => state.open && !state.readOnly);
    const canUndo = useDocument(state => state.past.length > 0);
    const canRedo = useDocument(state => state.future.length > 0);
    const fromKicad = useDocument(
        state => state.project.source.kind === "kicad"
    );
    // A list's Combined BOM is for its number of devices (#39).
    const combined = useWorkspace(state => state.selected === COMBINED);
    const devices = useWorkspace(state => state.list?.buildQuantity ?? 1);
    // A list that shows Combined or no BOM has Save, Undo and Redo of its
    // own (#77).
    const listOpen = useWorkspace(state => state.list !== null);
    const listShown = listOpen && (combined || !open);
    const canUndoList = useWorkspace(state => state.listPast.length > 0);
    const canRedoList = useWorkspace(state => state.listFuture.length > 0);

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
            {(editable || listShown) && (
                <button
                    type="button"
                    title={
                        listShown
                            ? "Save the list and its changed BOMs (Ctrl+S)"
                            : "Ctrl+S"
                    }
                    onClick={() => void saveDocument()}
                >
                    Save
                </button>
            )}
            {(editable || listShown) && (
                <>
                    <button
                        type="button"
                        className="icon"
                        title={
                            listShown
                                ? "Undo the last change of the list (Ctrl+Z)"
                                : "Undo (Ctrl+Z)"
                        }
                        aria-label="Undo"
                        disabled={listShown ? !canUndoList : !canUndo}
                        // Keep the focus where it is: in a text field, Undo
                        // undoes typing there.
                        onMouseDown={event => event.preventDefault()}
                        onClick={undo}
                    >
                        <UndoIcon />
                    </button>
                    <button
                        type="button"
                        className="icon"
                        title={
                            listShown
                                ? "Redo the change of the list (Ctrl+Y)"
                                : "Redo (Ctrl+Y)"
                        }
                        aria-label="Redo"
                        disabled={listShown ? !canRedoList : !canRedo}
                        onMouseDown={event => event.preventDefault()}
                        onClick={redo}
                    >
                        <RedoIcon />
                    </button>
                </>
            )}
            <span className="toolbar-separator" />
            <button
                type="button"
                title="Ctrl+I"
                onClick={() => void importCsv()}
            >
                Import CSV…
            </button>
            {open && fromKicad ? (
                <button
                    type="button"
                    title="Bring changes made in the KiCad project into the BOM"
                    onClick={syncKicad}
                >
                    Sync KiCad…
                </button>
            ) : (
                <button
                    type="button"
                    title="Ctrl+K"
                    onClick={() => void importKicad()}
                >
                    Import KiCad…
                </button>
            )}
            {editable && (
                <>
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
                    <label
                        className="toolbar-field"
                        title={BUILD_QUANTITY_HELP}
                    >
                        Build qty
                        {/* A new key resets the text after undo, redo or
                            opening a BOM. */}
                        <QuantityInput
                            key={buildQuantity}
                            value={buildQuantity}
                            max={MAX_BUILD_QUANTITY}
                            className="build-quantity"
                            onApply={setBuildQuantityOfBom}
                        />
                    </label>
                </>
            )}
            {open && combined && (
                <>
                    <span className="toolbar-separator" />
                    <label className="toolbar-field" title={DEVICES_HELP}>
                        Build qty
                        <QuantityInput
                            key={devices}
                            value={devices}
                            max={MAX_BUILD_QUANTITY}
                            className="build-quantity"
                            onApply={quantity =>
                                setListQuantities({ buildQuantity: quantity })
                            }
                        />
                    </label>
                </>
            )}
            {open && (
                <>
                    <span className="toolbar-separator" />
                    <button
                        type="button"
                        className="primary"
                        disabled={rows.length === 0}
                        onClick={openCollect}
                    >
                        Collect…
                    </button>
                    <button
                        type="button"
                        title="Remove the supplier data collected for the selected rows"
                        disabled={forgettable === 0}
                        onClick={() => void forgetSelectedData()}
                    >
                        Forget data…
                    </button>
                    <button
                        type="button"
                        title="Ctrl+E"
                        disabled={rows.length === 0}
                        onClick={openExport}
                    >
                        Export…
                    </button>
                    {fromKicad && (
                        <button
                            type="button"
                            title="Write the part numbers back into the KiCad project"
                            onClick={updateKicad}
                        >
                            Update KiCad…
                        </button>
                    )}
                </>
            )}
            <span className="toolbar-spacer" />
            <button type="button" title="Ctrl+," onClick={openSettings}>
                Settings…
            </button>
        </div>
    );
}
