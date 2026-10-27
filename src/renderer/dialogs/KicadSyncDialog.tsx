import { useEffect, useState } from "react";
import {
    applySync,
    planSync,
    readKicadBom,
    type KicadBom,
    type SyncChange,
    type SyncPlan
} from "../../shared/kicad-sync";
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

export function KicadSyncDialog({ onClose }: { onClose: () => void }) {
    const source = useDocument(state => state.project.source);
    const [state, setState] = useState<State>({ kind: "reading" });
    const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());

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
                applySync(project, state.kicad, state.plan, selected)
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
                changes.length > 0 ? (
                    <>
                        <button type="button" onClick={onClose}>
                            Cancel
                        </button>
                        <button
                            type="button"
                            className="primary"
                            disabled={selected.size === 0}
                            onClick={apply}
                        >
                            Apply {selected.size}{" "}
                            {selected.size === 1 ? "change" : "changes"}
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
                    {changes.length === 0 ? (
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
                        </>
                    )}
                </div>
            )}
        </Modal>
    );
}
