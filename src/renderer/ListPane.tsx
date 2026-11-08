import { fileTitle } from "../shared/bom-list";
import { MAX_LIST_DESCRIPTION, MAX_PER_DEVICE } from "../shared/bom-list-file";
import { checkHistory, openBomCosts, openUnify } from "./commands";
import {
    addBomsToList,
    chooseHistory,
    editListDescription,
    removeFromList,
    saveListDescription,
    selectInList,
    setListQuantities
} from "./list-commands";
import { QuantityInput } from "./QuantityInput";
import { isDirty, useDocument } from "./store/document";
import { useUi } from "./store/ui";
import { COMBINED, useWorkspace } from "./store/workspace";

function ListItem({
    id,
    name,
    title,
    unsaved,
    error,
    perDevice
}: {
    id: string;
    name: string;
    title: string;
    unsaved: boolean;
    error: string | undefined;
    /** How many of this BOM one device has (#39); none for the history. */
    perDevice?: number;
}) {
    const selected = useWorkspace(state => state.selected === id);
    return (
        <li className="list-row">
            <button
                type="button"
                className={selected ? "list-item selected" : "list-item"}
                aria-current={selected ? "true" : undefined}
                title={error ? `${title}\n${error}` : title}
                onClick={() => selectInList(id)}
            >
                <span className="list-item-name">{name}</span>
                {unsaved && (
                    <span
                        className="list-item-mark"
                        role="img"
                        aria-label="unsaved"
                        title="Unsaved changes"
                    />
                )}
                {error && (
                    <span className="list-item-error" aria-label="can't read">
                        !
                    </span>
                )}
            </button>
            {perDevice !== undefined && (
                <span
                    className="list-item-count"
                    title="How many of this BOM one device has, for the Combined BOM"
                >
                    ×
                    <QuantityInput
                        key={perDevice}
                        value={perDevice}
                        max={MAX_PER_DEVICE}
                        label={`${name} per device`}
                        onApply={count =>
                            void setListQuantities({ perDevice: [id, count] })
                        }
                    />
                </span>
            )}
        </li>
    );
}

/** The left side of a BOM list (#35): its BOMs, the Combined BOM and the
 *  history; the selected one is shown on the right. */
export function ListPane() {
    const list = useWorkspace(state => state.list);
    const selected = useWorkspace(state => state.selected);
    const documents = useWorkspace(state => state.documents);
    const errors = useWorkspace(state => state.errors);
    const message = useWorkspace(state => state.message);
    const shownUnsaved = useDocument(
        state => state.open && !state.readOnly && isDirty(state)
    );
    // Rows of the BOM shown to check against the history (#52).
    const checkable = useDocument(
        state => state.open && !state.readOnly && state.project.rows.length > 0
    );
    const selectedRows = useUi(state => state.selectedRowIds.length);
    if (!list) {
        return null;
    }
    const unsaved = (path: string) =>
        path === selected
            ? shownUnsaved
            : documents[path] !== undefined && isDirty(documents[path]);
    const item = (path: string, perDevice?: number) => (
        <ListItem
            key={path}
            id={path}
            name={fileTitle(path)}
            title={path}
            unsaved={unsaved(path)}
            error={errors[path]}
            perDevice={perDevice}
        />
    );
    const readable = list.boms.filter(path => !errors[path]).length;
    const canRemove = selected !== null && list.boms.includes(selected);

    return (
        <nav className="list-pane" aria-label="BOM list">
            <h2 className="list-pane-title" title={list.filePath}>
                {fileTitle(list.filePath)}
            </h2>
            {/* General information about the list (#72); saved as it's
                typed, like the list's other settings. */}
            <label className="list-description">
                <span>Description</span>
                <textarea
                    value={list.description}
                    rows={3}
                    maxLength={MAX_LIST_DESCRIPTION}
                    placeholder="What the BOMs are for, notes for ordering…"
                    onChange={event => editListDescription(event.target.value)}
                    onBlur={() => void saveListDescription()}
                />
            </label>
            {message && (
                <p className="list-pane-message" role="alert">
                    {message}
                </p>
            )}
            <h3>BOMs</h3>
            {list.boms.length > 0 ? (
                <ul className="list-items">
                    {list.boms.map(path =>
                        item(path, list.perDevice[path] ?? 1)
                    )}
                </ul>
            ) : (
                <p className="muted">No BOMs yet.</p>
            )}
            <div className="list-pane-actions">
                <button type="button" onClick={() => void addBomsToList()}>
                    Add BOMs…
                </button>
                <button
                    type="button"
                    disabled={!canRemove}
                    title="Take the selected BOM off the list; its file stays"
                    onClick={() => canRemove && void removeFromList(selected)}
                >
                    Remove
                </button>
            </div>
            <h3>All BOMs</h3>
            <ul className="list-items">
                <ListItem
                    id={COMBINED}
                    name="Combined"
                    title="The rows of all BOMs, with the quantities of the same part numbers added up, for the number of devices"
                    unsaved={false}
                    error={undefined}
                />
            </ul>
            <button
                type="button"
                className="primary"
                disabled={readable === 0}
                onClick={() => void openUnify()}
            >
                Unify part numbers…
            </button>
            <button
                type="button"
                disabled={readable === 0}
                title="What each BOM costs when they're ordered together"
                onClick={openBomCosts}
            >
                Cost by BOM…
            </button>
            <h3>History</h3>
            {list.history ? (
                <ul className="list-items">{item(list.history)}</ul>
            ) : (
                <p className="muted">No history BOM.</p>
            )}
            <button
                type="button"
                disabled={
                    !list.history ||
                    !checkable ||
                    selected === COMBINED ||
                    selected === list.history
                }
                title={
                    selectedRows > 0
                        ? `Look in the history for other part numbers of the ${selectedRows} selected ${selectedRows === 1 ? "row" : "rows"}, with their stock and prices`
                        : "Look in the history for other part numbers of the BOM's rows, with their stock and prices; select rows to check only those"
                }
                onClick={checkHistory}
            >
                Check History…
            </button>
            <div className="list-pane-actions">
                <button
                    type="button"
                    title="Use another BOM as the history of parts used before"
                    onClick={() => void chooseHistory()}
                >
                    Choose…
                </button>
            </div>
        </nav>
    );
}
