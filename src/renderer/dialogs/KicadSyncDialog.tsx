import { useEffect, useMemo, useState } from "react";
import {
    applySync,
    joinRows,
    planJoins,
    planSync,
    readKicadBom,
    type KicadBom,
    type RowJoin,
    type SyncChange,
    type SyncPlan
} from "../../shared/kicad-sync";
import type { Project } from "../../shared/model";
import { sortByReference } from "../../shared/references";
import { SUPPLIERS } from "../../shared/suppliers";
import { errorMessage } from "../errors";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

// Sync KiCad… (GitHub #30): lists what changed in the KiCad project since
// the import, so the chosen changes can be brought into the BOM.

type State =
    | { kind: "reading" }
    | { kind: "error"; message: string }
    | {
          kind: "ready";
          kicad: KicadBom;
          plan: SyncPlan;
          name: string;
          warnings: string[];
      };

const SECTIONS: { kind: SyncChange["kind"]; title: string }[] = [
    { kind: "column", title: "New supplier columns" },
    { kind: "added", title: "Added in KiCad" },
    { kind: "removed", title: "No longer in KiCad's BOM" },
    { kind: "changed", title: "Changed in KiCad" }
];

function describe(change: SyncChange): string {
    switch (change.kind) {
        case "column":
            return `${SUPPLIERS[change.supplier].name}, with ${change.count} part number${change.count === 1 ? "" : "s"}`;
        case "added":
            return `${change.references.join(", ")}${change.description ? ` · ${change.description}` : ""}`;
        case "removed":
            return change.references.join(",") === change.rowReferences
                ? `${change.rowReferences}`
                : `${change.references.join(", ")} (of ${change.rowReferences})`;
        case "changed":
            return `${change.references.join(", ")} · ${change.label}: ${change.from || "(empty)"} → ${change.to || "(empty)"}${change.bothChanged ? " · also changed in the BOM" : ""}`;
    }
}

function describeJoin(join: RowJoin): string {
    return `${join.references.join(", ")}${join.description ? ` · ${join.description}` : ""} · ${join.rowIds.length} rows`;
}

/** The ticked changes, then the ticked joins of rows that are the same
 *  component afterwards (#55), and the rows sorted by Reference (#67). */
function synced(
    project: Project,
    kicad: KicadBom,
    plan: SyncPlan,
    selected: ReadonlySet<string>,
    unjoined: ReadonlySet<string>,
    sort: boolean
): Project {
    const next = applySync(project, kicad, plan, selected);
    const joined = joinRows(
        next,
        planJoins(next, kicad).filter(join => !unjoined.has(join.id))
    );
    const rows = sort ? sortByReference(joined.rows) : joined.rows;
    return rows === joined.rows ? joined : { ...joined, rows: [...rows] };
}

const SORT_KEY = "sync-sort-by-reference";

/** Whether to sort the rows after a sync; yes unless unticked before. */
function loadSort(): boolean {
    try {
        return localStorage.getItem(SORT_KEY) !== "false";
    } catch {
        return true;
    }
}

function saveSort(sort: boolean): void {
    try {
        localStorage.setItem(SORT_KEY, String(sort));
    } catch {
        // Only a convenience.
    }
}

export function KicadSyncDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    const source = project.source;
    const [state, setState] = useState<State>({ kind: "reading" });
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
    // Joins are ticked unless unticked: which there are depends on the
    // ticked changes.
    const [unjoined, setUnjoined] = useState<ReadonlySet<string>>(new Set());
    // New rows go to the end; sorted, they're where their references say.
    const [sort, setSort] = useState(loadSort);
    const joins = useMemo(
        () =>
            state.kind === "ready"
                ? planJoins(
                      applySync(project, state.kicad, state.plan, selected),
                      state.kicad
                  )
                : [],
        [project, state, selected]
    );
    const joining = joins.filter(join => !unjoined.has(join.id)).length;
    const count = selected.size + joining;

    useEffect(() => {
        if (!source.path) {
            return;
        }
        const variantName = source.variant ?? "Default";
        window.api.files
            .openPath(source.path)
            .then(opened => {
                if (opened?.kind !== "kicad") {
                    setState({
                        kind: "error",
                        message: "The KiCad project couldn't be read."
                    });
                    return;
                }
                const variant = opened.project.variants.find(
                    v => v.name === variantName
                );
                if (!variant) {
                    setState({
                        kind: "error",
                        message: `The KiCad project has no "${variantName}" variant any more.`
                    });
                    return;
                }
                const project = useDocument.getState().project;
                const kicad = readKicadBom(project, variant.table);
                const plan = planSync(project, kicad);
                setSelected(new Set(plan.selected));
                setState({
                    kind: "ready",
                    kicad,
                    plan,
                    name: opened.project.name,
                    warnings: [...opened.project.warnings, ...variant.warnings]
                });
            })
            .catch((error: unknown) =>
                setState({ kind: "error", message: errorMessage(error) })
            );
    }, [source.path, source.variant]);

    const apply = () => {
        if (state.kind !== "ready") {
            return;
        }
        useDocument
            .getState()
            .edit(project =>
                synced(
                    project,
                    state.kicad,
                    state.plan,
                    selected,
                    unjoined,
                    sort
                )
            );
        onClose();
    };

    const changes = state.kind === "ready" ? state.plan.changes : [];
    return (
        <Modal
            title="Sync with the KiCad project"
            name="kicad-sync"
            size="large"
            onClose={onClose}
            footer={
                changes.length + joins.length > 0 ? (
                    <>
                        <button type="button" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="primary"
                            disabled={count === 0}
                            onClick={apply}
                        >
                            Apply {count} {count === 1 ? "change" : "changes"}
                        </button>
                    </>
                ) : (
                    <button type="button" onClick={onClose}>
                        Close
                    </button>
                )
            }
        >
            {state.kind === "reading" && (
                <p className="muted">Reading the KiCad project…</p>
            )}
            {state.kind === "error" && (
                <p className="field-error">{state.message}</p>
            )}
            {state.kind === "ready" && (
                <div className="kicad-update">
                    <p>
                        <strong>{state.name}</strong>,{" "}
                        {source.variant ?? "Default"} variant
                        <br />
                        <span className="muted">{source.path}</span>
                    </p>
                    {state.warnings.map(warning => (
                        <p key={warning} className="warning">
                            {warning}
                        </p>
                    ))}
                    {changes.length + joins.length === 0 ? (
                        <p>
                            Nothing changed in KiCad that the BOM doesn&apos;t
                            have.
                        </p>
                    ) : (
                        <>
                            <p className="muted">
                                Rows and columns added in the BOM, and values
                                changed only in the BOM, are kept. Ticked
                                changes are brought into the BOM; Ctrl+Z undoes
                                them.
                            </p>
                            {SECTIONS.map(section => {
                                const items = changes.filter(
                                    change => change.kind === section.kind
                                );
                                return (
                                    items.length > 0 && (
                                        <fieldset
                                            key={section.kind}
                                            className="kicad-columns"
                                        >
                                            <legend>
                                                {section.title} ({items.length})
                                            </legend>
                                            {items.map(change => (
                                                <label
                                                    key={change.id}
                                                    className="checkbox"
                                                >
                                                    <input
                                                        type="checkbox"
                                                        checked={selected.has(
                                                            change.id
                                                        )}
                                                        onChange={event => {
                                                            const next =
                                                                new Set(
                                                                    selected
                                                                );
                                                            if (
                                                                event.target
                                                                    .checked
                                                            ) {
                                                                next.add(
                                                                    change.id
                                                                );
                                                            } else {
                                                                next.delete(
                                                                    change.id
                                                                );
                                                            }
                                                            setSelected(next);
                                                        }}
                                                    />
                                                    {describe(change)}
                                                </label>
                                            ))}
                                        </fieldset>
                                    )
                                );
                            })}
                            {joins.length > 0 && (
                                <fieldset className="kicad-columns">
                                    <legend>
                                        Rows to join into one ({joins.length})
                                    </legend>
                                    <p className="muted">
                                        Parts KiCad lists in one row, with the
                                        same Value, Footprint and part numbers,
                                        e.g. after KiCad renumbered them.
                                    </p>
                                    {joins.map(join => (
                                        <label
                                            key={join.id}
                                            className="checkbox"
                                        >
                                            <input
                                                type="checkbox"
                                                checked={!unjoined.has(join.id)}
                                                onChange={event => {
                                                    const next = new Set(
                                                        unjoined
                                                    );
                                                    if (event.target.checked) {
                                                        next.delete(join.id);
                                                    } else {
                                                        next.add(join.id);
                                                    }
                                                    setUnjoined(next);
                                                }}
                                            />
                                            {describeJoin(join)}
                                        </label>
                                    ))}
                                </fieldset>
                            )}
                            <label className="checkbox">
                                <input
                                    type="checkbox"
                                    checked={sort}
                                    onChange={event => {
                                        setSort(event.target.checked);
                                        saveSort(event.target.checked);
                                    }}
                                />
                                Sort the rows by Reference, so added parts are
                                where their references put them
                            </label>
                        </>
                    )}
                </div>
            )}
        </Modal>
    );
}
