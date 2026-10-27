import { useEffect, useState } from "react";
import type {
    KicadUpdatePlan,
    KicadUpdateRequest,
    KicadUpdateResult
} from "../../shared/ipc";
import { markWrittenToKicad } from "../../shared/kicad-sync";
import type { Project } from "../../shared/model";
import { SUPPLIERS } from "../../shared/suppliers";
import { errorMessage } from "../errors";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

// Writes the BOM's part numbers (and custom columns) back into the KiCad
// project it was imported from: a preview first, then a backup and the
// update, which can be rolled back from here.

type State =
    | { kind: "planning" }
    | { kind: "error"; message: string }
    | { kind: "preview"; plan: KicadUpdatePlan; updating: boolean }
    | { kind: "done"; result: KicadUpdateResult; restored: boolean };

function updateRequest(project: Project): KicadUpdateRequest {
    return {
        projectPath: project.source.path ?? "",
        variant: project.source.variant ?? "Default",
        columns: [
            ...project.suppliers.map(supplier => ({
                key: `pn:${supplier}`,
                label: SUPPLIERS[supplier].name,
                supplier
            })),
            ...project.customColumns.map(column => ({
                key: `custom:${column.id}`,
                label: column.name,
                field: column.name
            }))
        ],
        rows: project.rows.map(row => ({
            reference: row.reference,
            values: {
                ...Object.fromEntries(
                    project.suppliers.map(supplier => [
                        `pn:${supplier}`,
                        row.partNumbers[supplier] ?? ""
                    ])
                ),
                ...Object.fromEntries(
                    project.customColumns.map(column => [
                        `custom:${column.id}`,
                        String(row.custom[column.id] ?? "")
                    ])
                )
            }
        }))
    };
}

function plural(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function KicadUpdateDialog({ onClose }: { onClose: () => void }) {
    // Fixed when the dialog opens: recording what was written changes the
    // BOM, which mustn't start a new preview.
    const [request] = useState(() =>
        updateRequest(useDocument.getState().project)
    );
    const [state, setState] = useState<State>({ kind: "planning" });
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

    useEffect(() => {
        window.api.kicad
            .planUpdate(request)
            .then(plan => {
                setSelected(
                    new Set(
                        plan.columns
                            .filter(column => column.changes > 0)
                            .map(column => column.key)
                    )
                );
                setState({ kind: "preview", plan, updating: false });
            })
            .catch((error: unknown) =>
                setState({ kind: "error", message: errorMessage(error) })
            );
    }, [request]);

    const update = async (plan: KicadUpdatePlan) => {
        setState({ kind: "preview", plan, updating: true });
        try {
            const result = await window.api.kicad.applyUpdate(request, [
                ...selected
            ]);
            const written = plan.changes.filter(c => selected.has(c.key));
            useDocument
                .getState()
                .edit(project => markWrittenToKicad(project, written));
            setState({ kind: "done", result, restored: false });
        } catch (error) {
            setState({ kind: "error", message: errorMessage(error) });
        }
    };

    const changes =
        state.kind === "preview"
            ? state.plan.changes.filter(change => selected.has(change.key))
            : [];
    const busy = state.kind === "preview" && state.updating;

    return (
        <Modal
            title="Update KiCad project"
            name="kicad-update"
            size="large"
            onClose={() => !busy && onClose()}
            footer={
                state.kind === "preview" ? (
                    <>
                        <button type="button" onClick={onClose} disabled={busy}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="primary"
                            disabled={busy || changes.length === 0}
                            onClick={() => void update(state.plan)}
                        >
                            {busy ? "Updating…" : "Update KiCad project"}
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                )
            }
        >
            {state.kind === "planning" && (
                <p className="muted">Reading the KiCad project…</p>
            )}
            {state.kind === "error" && (
                <p className="field-error">{state.message}</p>
            )}
            {state.kind === "preview" && (
                <Preview
                    plan={state.plan}
                    rows={request.rows.length}
                    path={request.projectPath}
                    selected={selected}
                    changes={changes}
                    onSelect={setSelected}
                />
            )}
            {state.kind === "done" && (
                <Done
                    result={state.result}
                    restored={state.restored}
                    onRestored={() => setState({ ...state, restored: true })}
                />
            )}
        </Modal>
    );
}

function Preview({
    plan,
    rows,
    path,
    selected,
    changes,
    onSelect
}: {
    plan: KicadUpdatePlan;
    rows: number;
    path: string;
    selected: ReadonlySet<string>;
    changes: KicadUpdatePlan["changes"];
    onSelect: (selected: ReadonlySet<string>) => void;
}) {
    return (
        <div className="kicad-update">
            <p>
                <strong>{plan.projectName}</strong>, {plan.variant} variant:{" "}
                {plan.matchedRows} of {plural(rows, "BOM row")} match a row of
                KiCad&apos;s BOM exactly (same references). Only those are
                written.
                <br />
                <span className="muted">{path}</span>
            </p>
            {plan.warnings.map(warning => (
                <p key={warning} className="warning">
                    {warning}
                </p>
            ))}

            <fieldset className="kicad-columns">
                <legend>Columns to write</legend>
                {plan.columns.map(column => (
                    <label key={column.key} className="checkbox">
                        <input
                            type="checkbox"
                            checked={selected.has(column.key)}
                            disabled={column.changes === 0}
                            onChange={event => {
                                const next = new Set(selected);
                                if (event.target.checked) {
                                    next.add(column.key);
                                } else {
                                    next.delete(column.key);
                                }
                                onSelect(next);
                            }}
                        />
                        {column.label} → field &quot;{column.field}&quot;
                        {column.newField && " (added where needed)"}:{" "}
                        {plural(column.changes, "change")}
                    </label>
                ))}
            </fieldset>

            {changes.length === 0 ? (
                <p className="muted">
                    Nothing to change: the matching rows already have these
                    values in KiCad.
                </p>
            ) : (
                <div className="kicad-changes">
                    <table className="mapping">
                        <thead>
                            <tr>
                                <th>References</th>
                                <th>Field</th>
                                <th>In KiCad</th>
                                <th>New value</th>
                            </tr>
                        </thead>
                        <tbody>
                            {changes.map(change => (
                                <tr key={`${change.key}/${change.references}`}>
                                    <td>{change.references}</td>
                                    <td>{change.field}</td>
                                    <td className="muted">
                                        {change.from || "(empty)"}
                                    </td>
                                    <td>{change.to || "(empty)"}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            {plan.skipped.length > 0 && (
                <details>
                    <summary>
                        {plural(plan.skipped.length, "row")} left out
                    </summary>
                    <ul className="kicad-skipped">
                        {plan.skipped.map(row => (
                            <li key={row.references}>
                                <strong>{row.references}</strong>: {row.reason}
                            </li>
                        ))}
                    </ul>
                </details>
            )}

            <p className="muted">
                The project&apos;s files are copied to bom-checker-backups in
                the project folder first, so the update can be undone.
            </p>
        </div>
    );
}

function Done({
    result,
    restored,
    onRestored
}: {
    result: KicadUpdateResult;
    restored: boolean;
    onRestored: () => void;
}) {
    const [error, setError] = useState<string | null>(null);
    const restore = async () => {
        try {
            if (await window.api.kicad.restoreBackup(result.backupFolder)) {
                onRestored();
            }
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    return (
        <div className="kicad-update" role="status">
            {restored ? (
                <p className="success">
                    The KiCad project is back as it was before the update.
                </p>
            ) : (
                <p className="success">
                    Updated {plural(result.changes, "value")} in{" "}
                    {result.files.join(", ")}.
                </p>
            )}
            <p>
                Backup: {result.backupFolder}{" "}
                <button
                    type="button"
                    className="link"
                    onClick={() =>
                        window.api.kicad.showBackup(result.backupFolder)
                    }
                >
                    Show
                </button>
            </p>
            {!restored && (
                <p>
                    <button type="button" onClick={() => void restore()}>
                        Restore the backup
                    </button>
                </p>
            )}
            {error && <p className="field-error">{error}</p>}
            <p className="muted">
                If the schematic is open in KiCad, close it without saving and
                open it again to see the changes.
            </p>
        </div>
    );
}
