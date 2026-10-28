import { fileTitle } from "../shared/bom-list";
import { openUnify } from "./commands";
import {
    addBomsToList,
    chooseHistory,
    removeFromList,
    selectInList
} from "./list-commands";
import { isDirty, useDocument } from "./store/document";
import { COMBINED, useWorkspace } from "./store/workspace";

function ListItem({
    id,
    name,
    title,
    unsaved,
    error
}: {
    id: string;
    name: string;
    title: string;
    unsaved: boolean;
    error: string | undefined;
}) {
    const selected = useWorkspace(state => state.selected === id);
    return (
        <li>
            <button
                type="button"
                className={selected ? "list-item selected" : "list-item"}
                aria-current={selected ? "true" : undefined}
                title={error ? `${title}\n${error}` : title}
                onClick={() => selectInList(id)}
            >
                <span className="list-item-name">{name}</span>
                {unsaved && (
                    <span className="list-item-mark" aria-label="unsaved">
                        •
                    </span>
                )}
                {error && (
                    <span className="list-item-error" aria-label="can't read">
                        !
                    </span>
                )}
            </button>
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
    if (!list) {
        return null;
    }
    const unsaved = (path: string) =>
        path === selected
            ? shownUnsaved
            : documents[path] !== undefined && isDirty(documents[path]);
    const item = (path: string) => (
        <ListItem
            key={path}
            id={path}
            name={fileTitle(path)}
            title={path}
            unsaved={unsaved(path)}
            error={errors[path]}
        />
    );
    const readable = list.boms.filter(path => !errors[path]).length;
    const canRemove = selected !== null && list.boms.includes(selected);

    return (
        <nav className="list-pane" aria-label="BOM list">
            <h2 className="list-pane-title" title={list.filePath}>
                {fileTitle(list.filePath)}
            </h2>
            {message && (
                <p className="list-pane-message" role="alert">
                    {message}
                </p>
            )}
            <h3>BOMs</h3>
            {list.boms.length > 0 ? (
                <ul className="list-items">{list.boms.map(item)}</ul>
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
                    title="The rows of all BOMs, with the quantities of the same part numbers added up"
                    unsaved={false}
                    error={undefined}
                />
            </ul>
            <button
                type="button"
                className="primary"
                disabled={readable === 0}
                onClick={openUnify}
            >
                Unify part numbers…
            </button>
            <h3>History</h3>
            {list.history ? (
                <ul className="list-items">{item(list.history)}</ul>
            ) : (
                <p className="muted">No history BOM.</p>
            )}
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
