import { useState } from "react";
import type {
    ColumnType,
    CustomColumn,
    ManualSupplier
} from "../../shared/model";
import {
    addCustomColumn,
    addManualSupplier,
    addSupplier,
    customColumnHasValues,
    deleteCustomColumn,
    deleteManualSupplier,
    manualSupplierHasValues,
    removeSupplier,
    renameCustomColumn,
    renameManualSupplier,
    supplierHasValues,
    validateColumnName
} from "../../shared/project-ops";
import { arrowSources } from "../../shared/supplier-config";
import { ALL_SUPPLIERS, type SupplierInfo } from "../../shared/suppliers";
import { useAppSettings } from "../store/settings";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

// Changes apply immediately, and each one can be undone with Ctrl+Z.

export function ColumnsDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    // Arrow's inventory sources chosen in Settings (#62), and any the BOM
    // has anyway.
    const sources = useAppSettings(state =>
        arrowSources(state.settings.suppliers.arrow).join(",")
    ).split(",");
    const offered = ALL_SUPPLIERS.filter(
        supplier =>
            !supplier.source ||
            sources.includes(supplier.source) ||
            project.suppliers.includes(supplier.id)
    );

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
                    {offered.map(supplier => (
                        <SupplierOption
                            key={supplier.id}
                            supplier={supplier}
                            checked={project.suppliers.includes(supplier.id)}
                        />
                    ))}
                </div>
                <p className="muted">
                    Arrow&apos;s inventory sources, e.g. Arrow (EUROPE), are
                    chosen in Settings → Suppliers → Arrow.
                </p>
            </section>
            <section>
                <h3>Suppliers without an API</h3>
                <p className="muted">
                    For parts no supplier above has, e.g. a display from a local
                    shop or an enclosure made to order: type the part number,
                    unit price (EUR), stock and MOQ into the table. They count
                    for the best price like the others.
                </p>
                {project.manualSuppliers.length > 0 && (
                    <ul className="custom-columns">
                        {project.manualSuppliers.map(supplier => (
                            <ManualSupplierItem
                                key={supplier.id}
                                supplier={supplier}
                            />
                        ))}
                    </ul>
                )}
                <AddManualSupplier />
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

function ManualSupplierItem({ supplier }: { supplier: ManualSupplier }) {
    const [name, setName] = useState(supplier.name);
    const project = useDocument(state => state.project);
    const error =
        name.trim() === supplier.name
            ? null
            : validateColumnName(project, name, supplier.id);

    const commit = () => {
        if (!error) {
            useDocument
                .getState()
                .edit(p => renameManualSupplier(p, supplier.id, name));
        }
    };

    const remove = async () => {
        const { project, edit } = useDocument.getState();
        const confirmed =
            !manualSupplierHasValues(project, supplier.id) ||
            (await window.api.dialog.confirm({
                message: `Delete the supplier "${supplier.name}"?`,
                detail: "Its part numbers, prices and stock are deleted too. You can undo this with Ctrl+Z.",
                confirmLabel: "Delete"
            }));
        if (confirmed) {
            edit(p => deleteManualSupplier(p, supplier.id));
        }
    };

    return (
        <li>
            <input
                aria-label="Supplier name"
                value={name}
                onChange={event => setName(event.target.value)}
                onBlur={commit}
                onKeyDown={event => event.key === "Enter" && commit()}
                aria-invalid={error !== null}
            />
            <button type="button" onClick={() => void remove()}>
                Delete
            </button>
            {error && <div className="field-error">{error}</div>}
        </li>
    );
}

function AddManualSupplier() {
    const [name, setName] = useState("");
    const project = useDocument(state => state.project);
    const error = name.trim() === "" ? null : validateColumnName(project, name);

    const add = () => {
        if (name.trim() === "" || error) {
            return;
        }
        useDocument.getState().edit(p => addManualSupplier(p, name).project);
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
                aria-label="New supplier name"
                placeholder="Supplier name"
                value={name}
                onChange={event => setName(event.target.value)}
                aria-invalid={error !== null}
            />
            <button type="submit" disabled={name.trim() === "" || !!error}>
                Add supplier
            </button>
            {error && <div className="field-error">{error}</div>}
        </form>
    );
}
