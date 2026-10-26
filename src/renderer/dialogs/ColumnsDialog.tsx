import { useState } from "react";
import type { ColumnType, CustomColumn } from "../../shared/model";
import {
    addCustomColumn,
    addSupplier,
    customColumnHasValues,
    deleteCustomColumn,
    removeSupplier,
    renameCustomColumn,
    supplierHasValues,
    validateColumnName
} from "../../shared/project-ops";
import { ALL_SUPPLIERS, type SupplierInfo } from "../../shared/suppliers";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

// Changes apply immediately, and each one can be undone with Ctrl+Z.

export function ColumnsDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);

    return (
        <Modal
            title="Columns"
            name="columns"
            onClose={onClose}
            footer={
                <button type="button" onClick={onClose}>
                    Close
                </button>
            }
        >
            <section>
                <h3>Supplier part numbers</h3>
                <div className="supplier-options">
                    {ALL_SUPPLIERS.map(supplier => (
                        <SupplierOption
                            key={supplier.id}
                            supplier={supplier}
                            checked={project.suppliers.includes(supplier.id)}
                        />
                    ))}
                </div>
            </section>
            <section>
                <h3>Custom columns</h3>
                {project.customColumns.length === 0 ? (
                    <p className="muted">No custom columns.</p>
                ) : (
                    <ul className="custom-columns">
                        {project.customColumns.map(column => (
                            <CustomColumnItem key={column.id} column={column} />
                        ))}
                    </ul>
                )}
                <AddCustomColumn />
            </section>
        </Modal>
    );
}

function SupplierOption({
    supplier,
    checked
}: {
    supplier: SupplierInfo;
    checked: boolean;
}) {
    const toggle = async (add: boolean) => {
        const { project, edit } = useDocument.getState();
        if (add) {
            edit(p => addSupplier(p, supplier.id));
            return;
        }
        const confirmed =
            !supplierHasValues(project, supplier.id) ||
            (await window.api.dialog.confirm({
                message: `Remove the ${supplier.name} column?`,
                detail: `Its part numbers are removed too. You can undo this with Ctrl+Z.`,
                confirmLabel: "Remove"
            }));
        if (confirmed) {
            edit(p => removeSupplier(p, supplier.id));
        }
    };

    return (
        <label>
            <input
                type="checkbox"
                checked={checked}
                onChange={event => void toggle(event.target.checked)}
            />
            {supplier.name}
        </label>
    );
}

function CustomColumnItem({ column }: { column: CustomColumn }) {
    const [name, setName] = useState(column.name);
    const project = useDocument(state => state.project);
    const error =
        name.trim() === column.name
            ? null
            : validateColumnName(project, name, column.id);

    const commit = () => {
        if (!error) {
            useDocument
                .getState()
                .edit(p => renameCustomColumn(p, column.id, name));
        }
    };

    const remove = async () => {
        const { project, edit } = useDocument.getState();
        const confirmed =
            !customColumnHasValues(project, column.id) ||
            (await window.api.dialog.confirm({
                message: `Delete the "${column.name}" column?`,
                detail: "Its values are deleted too. You can undo this with Ctrl+Z.",
                confirmLabel: "Delete"
            }));
        if (confirmed) {
            edit(p => deleteCustomColumn(p, column.id));
        }
    };

    return (
        <li>
            <input
                aria-label="Column name"
                value={name}
                onChange={event => setName(event.target.value)}
                onBlur={commit}
                onKeyDown={event => event.key === "Enter" && commit()}
                aria-invalid={error !== null}
            />
            <span className="muted">{column.type}</span>
            <button type="button" onClick={() => void remove()}>
                Delete
            </button>
            {error && <div className="field-error">{error}</div>}
        </li>
    );
}

function AddCustomColumn() {
    const [name, setName] = useState("");
    const [type, setType] = useState<ColumnType>("text");
    const project = useDocument(state => state.project);
    const error = name.trim() === "" ? null : validateColumnName(project, name);

    const add = () => {
        if (name.trim() === "" || error) {
            return;
        }
        useDocument
            .getState()
            .edit(p => addCustomColumn(p, name, type).project);
        setName("");
    };

    return (
        <form
            className="add-column"
            onSubmit={event => {
                event.preventDefault();
                add();
            }}
        >
            <input
                aria-label="New column name"
                placeholder="New column name"
                value={name}
                onChange={event => setName(event.target.value)}
                aria-invalid={error !== null}
            />
            <select
                aria-label="New column type"
                value={type}
                onChange={event => setType(event.target.value as ColumnType)}
            >
                <option value="text">Text</option>
                <option value="number">Number</option>
            </select>
            <button type="submit" disabled={name.trim() === "" || !!error}>
                Add column
            </button>
            {error && <div className="field-error">{error}</div>}
        </form>
    );
}
