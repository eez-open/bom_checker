import { useEffect, useId, useMemo, useState } from "react";
import {
    apiDataInExport,
    buildBomSheet,
    buildInfoSheet,
    builtInPresets,
    describeRowFilter,
    type ExportFormat,
    type ExportPreset,
    type ExportSelection,
    type RowFilter
} from "../../shared/export";
import type { VaultState } from "../../shared/ipc";
import type { SupplierId } from "../../shared/model";
import { SUPPLIERS } from "../../shared/suppliers";
import { errorMessage } from "../errors";
import { fileTitle } from "../../shared/bom-list";
import { documentName, useDocument } from "../store/document";
import { useWorkspace } from "../store/workspace";
import { setAppSettings, useAppSettings, useNumbers } from "../store/settings";
import { Modal } from "./Modal";

const FORMATS: { id: ExportFormat; label: string }[] = [
    { id: "xlsx", label: "Excel (.xlsx)" },
    { id: "ods", label: "LibreOffice (.ods)" },
    { id: "csv", label: "CSV (.csv)" }
];

function rowsText(count: number): string {
    return `${count} ${count === 1 ? "row" : "rows"}`;
}

function sameSelection(a: ExportSelection, b: ExportSelection): boolean {
    return JSON.stringify(a) === JSON.stringify(b);
}

/** "DigiKey", "DigiKey and Mouser", "DigiKey, Mouser and TME". */
function namesText(suppliers: readonly SupplierId[]): string {
    const names = suppliers.map(supplier => SUPPLIERS[supplier].name);
    return names.length > 1
        ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`
        : (names[0] ?? "");
}

/**
 * Before an export with supplier data (#44): the suppliers' API terms
 * don't allow passing it on, so the user confirms with the password of
 * the supplier settings that they know. Without a password, a checkbox.
 */
function ConfirmExport({
    suppliers,
    onBack,
    onConfirmed,
    onClose
}: {
    suppliers: readonly SupplierId[];
    onBack: () => void;
    onConfirmed: () => void;
    onClose: () => void;
}) {
    const formId = useId();
    const passwordId = useId();
    const [state, setState] = useState<VaultState | null>(null);
    const [password, setPassword] = useState("");
    const [understood, setUnderstood] = useState(false);
    const [checking, setChecking] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        window.api.vault
            .getState()
            .then(setState)
            .catch((caught: unknown) => setError(errorMessage(caught)));
    }, []);

    const confirm = async () => {
        if (state === "none") {
            onConfirmed();
            return;
        }
        setChecking(true);
        try {
            if (await window.api.vault.checkPassword(password)) {
                onConfirmed();
                return;
            }
            setError("Wrong password.");
        } catch (caught) {
            setError(errorMessage(caught));
        }
        setChecking(false);
    };

    return (
        <Modal
            title="Export supplier data?"
            onClose={onClose}
            footer={
                <>
                    <button type="button" onClick={onBack}>
                        Back
                    </button>
                    <button
                        type="submit"
                        form={formId}
                        className="primary"
                        disabled={
                            state === null ||
                            checking ||
                            (state === "none" ? !understood : password === "")
                        }
                    >
                        Export…
                    </button>
                </>
            }
        >
            <form
                id={formId}
                className="settings-form"
                onSubmit={event => {
                    event.preventDefault();
                    void confirm();
                }}
            >
                <p role="alert">
                    The export contains data from {namesText(suppliers)}: stock,
                    prices and the rest collected through their APIs. Their
                    terms don&apos;t allow passing it on, so keep the file to
                    yourself; don&apos;t publish or share it. To share the BOM,
                    export <em>Basic data only</em>.
                </p>
                {state === "none" ? (
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={understood}
                            onChange={event =>
                                setUnderstood(event.target.checked)
                            }
                        />
                        I&apos;ll keep the file to myself
                    </label>
                ) : (
                    <div className="form-row">
                        <label htmlFor={passwordId}>Password</label>
                        <input
                            id={passwordId}
                            type="password"
                            autoComplete="off"
                            autoFocus
                            value={password}
                            onChange={event => {
                                setPassword(event.target.value);
                                setError(null);
                            }}
                        />
                    </div>
                )}
                {state !== "none" && (
                    <p className="muted">
                        The password of the supplier settings confirms the
                        export.
                    </p>
                )}
                {error && <p className="field-error">{error}</p>}
            </form>
        </Modal>
    );
}

export function ExportDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    const listName = useWorkspace(state =>
        state.list ? fileTitle(state.list.filePath) : null
    );
    const name = useDocument(state =>
        state.readOnly && listName
            ? `${listName} (combined)`
            : documentName(state.filePath)
    );
    const settings = useAppSettings(state => state.settings);
    const preference = settings.general.supplierOrder;
    const savedPresets = settings.general.exportPresets;
    const numbers = useNumbers();
    const presets: { preset: ExportPreset; saved: boolean }[] = [
        ...builtInPresets(project).map(preset => ({ preset, saved: false })),
        ...savedPresets.map(preset => ({ preset, saved: true }))
    ];

    const [selection, setSelection] = useState<ExportSelection>(
        () => builtInPresets(project)[0]!.selection
    );
    const [format, setFormat] = useState<ExportFormat>("xlsx");
    const [presetName, setPresetName] = useState("");
    const [error, setError] = useState<string | null>(null);
    const [exportedTo, setExportedTo] = useState<string | null>(null);
    // Supplier data in the export, to confirm first (#44).
    const apiData = apiDataInExport(project, selection);
    const [confirming, setConfirming] = useState(false);

    // The preset the current selection matches, if any.
    const current = presets.find(p =>
        sameSelection(p.preset.selection, selection)
    );
    const bom = useMemo(
        () => buildBomSheet(project, preference, selection, numbers),
        [project, preference, selection, numbers]
    );

    const rowOptions: RowFilter[] = [
        { kind: "all" },
        ...project.suppliers.flatMap((supplier): RowFilter[] => [
            { kind: "has-part-number", supplier },
            { kind: "best-is", supplier }
        ]),
        { kind: "not-available" }
    ];

    const savePresets = async (exportPresets: ExportPreset[]) => {
        try {
            setAppSettings(
                await window.api.settings.saveGeneral({
                    ...settings.general,
                    exportPresets
                })
            );
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    const runExport = async () => {
        setError(null);
        const sheets = [bom];
        if (format !== "csv") {
            sheets.push(
                buildInfoSheet(project, bom, {
                    documentName: name,
                    documentPath: useDocument.getState().filePath,
                    exportedAt: new Date().toISOString(),
                    presetName: current?.preset.name ?? null,
                    selection,
                    preference
                })
            );
        }
        try {
            const path = await window.api.export.save({
                format,
                suggestedName: current
                    ? `${name} - ${current.preset.name}`
                    : name,
                sheets,
                decimalComma: numbers.decimalComma
            });
            if (path) {
                setExportedTo(path);
            }
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

    if (confirming) {
        return (
            <ConfirmExport
                suppliers={apiData}
                onBack={() => setConfirming(false)}
                onConfirmed={() => {
                    setConfirming(false);
                    void runExport();
                }}
                onClose={onClose}
            />
        );
    }

    if (exportedTo) {
        return (
            <Modal
                title="Export"
                onClose={onClose}
                footer={
                    <>
                        <button
                            type="button"
                            onClick={() =>
                                window.api.export.showInFolder(exportedTo)
                            }
                        >
                            Show in folder
                        </button>
                        <button
                            type="button"
                            className="primary"
                            onClick={onClose}
                        >
                            Close
                        </button>
                    </>
                }
            >
                <p role="status">
                    Exported {rowsText(bom.rows.length - 1)} to {exportedTo}
                </p>
            </Modal>
        );
    }

    return (
        <Modal
            title="Export"
            size="large"
            name="export"
            onClose={onClose}
            footer={
                <>
                    <span className="modal-footer-info">
                        {rowsText(bom.rows.length - 1)} · {bom.rows[0]!.length}{" "}
                        columns
                    </span>
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="primary"
                        disabled={bom.rows.length < 2}
                        onClick={() =>
                            apiData.length > 0
                                ? setConfirming(true)
                                : void runExport()
                        }
                    >
                        Export…
                    </button>
                </>
            }
        >
            <div className="settings-form">
                <div className="form-row">
                    <label htmlFor="export-preset">Preset</label>
                    <select
                        id="export-preset"
                        value={current?.preset.name ?? ""}
                        onChange={event => {
                            const chosen = presets.find(
                                p => p.preset.name === event.target.value
                            );
                            if (chosen) {
                                setSelection(chosen.preset.selection);
                            }
                        }}
                    >
                        {!current && <option value="">Custom</option>}
                        {presets.map(({ preset, saved }) => (
                            <option
                                key={`${saved}-${preset.name}`}
                                value={preset.name}
                            >
                                {preset.name}
                                {saved ? " (saved)" : ""}
                            </option>
                        ))}
                    </select>
                </div>

                <fieldset className="checkbox-list">
                    <legend>Columns</legend>
                    <p className="muted">
                        Always: Row, Reference, Value, Qty, Footprint.
                    </p>
                    {project.suppliers.map(supplier => (
                        <label key={supplier} className="checkbox">
                            <input
                                type="checkbox"
                                checked={selection.suppliers.includes(supplier)}
                                onChange={event =>
                                    setSelection({
                                        ...selection,
                                        suppliers: event.target.checked
                                            ? [...selection.suppliers, supplier]
                                            : selection.suppliers.filter(
                                                  s => s !== supplier
                                              )
                                    })
                                }
                            />
                            {SUPPLIERS[supplier].name} part numbers
                            {!selection.partNumbersOnly && " and data"}
                        </label>
                    ))}
                    {project.suppliers.length > 0 && (
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={selection.partNumbersOnly === true}
                                onChange={event =>
                                    setSelection({
                                        ...selection,
                                        partNumbersOnly: event.target.checked
                                    })
                                }
                            />
                            Part numbers only, without the suppliers&apos; data
                        </label>
                    )}
                    {project.manualSuppliers.length > 0 && (
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={selection.manual === true}
                                onChange={event =>
                                    setSelection({
                                        ...selection,
                                        manual: event.target.checked
                                    })
                                }
                            />
                            Suppliers without an API (
                            {project.manualSuppliers
                                .map(s => s.name)
                                .join(", ")}
                            )
                        </label>
                    )}
                    <label className="checkbox">
                        <input
                            type="checkbox"
                            checked={selection.best}
                            onChange={event =>
                                setSelection({
                                    ...selection,
                                    best: event.target.checked
                                })
                            }
                        />
                        Best price
                    </label>
                    {project.customColumns.length > 0 && (
                        <label className="checkbox">
                            <input
                                type="checkbox"
                                checked={selection.custom}
                                onChange={event =>
                                    setSelection({
                                        ...selection,
                                        custom: event.target.checked
                                    })
                                }
                            />
                            Custom columns (
                            {project.customColumns.map(c => c.name).join(", ")})
                        </label>
                    )}
                </fieldset>

                <div className="form-row">
                    <label htmlFor="export-rows">Rows</label>
                    <select
                        id="export-rows"
                        value={rowOptions.findIndex(
                            filter =>
                                JSON.stringify(filter) ===
                                JSON.stringify(selection.rows)
                        )}
                        onChange={event => {
                            const rows = rowOptions[Number(event.target.value)];
                            if (rows) {
                                setSelection({ ...selection, rows });
                            }
                        }}
                    >
                        {rowOptions.map((filter, index) => (
                            <option key={index} value={index}>
                                {describeRowFilter(filter)}
                            </option>
                        ))}
                    </select>
                </div>

                <div className="form-row">
                    <span>Format</span>
                    <div
                        className="collect-modes"
                        role="radiogroup"
                        aria-label="Format"
                    >
                        {FORMATS.map(option => (
                            <label key={option.id}>
                                <input
                                    type="radio"
                                    name="export-format"
                                    checked={format === option.id}
                                    onChange={() => setFormat(option.id)}
                                />
                                {option.label}
                            </label>
                        ))}
                        {format !== "csv" && (
                            <span className="muted">
                                An Info sheet says what was exported and how
                                prices were chosen.
                            </span>
                        )}
                    </div>
                </div>

                <fieldset>
                    <legend>Presets</legend>
                    {current?.saved ? (
                        <button
                            type="button"
                            onClick={() =>
                                void savePresets(
                                    savedPresets.filter(
                                        p => p.name !== current.preset.name
                                    )
                                )
                            }
                        >
                            Delete preset "{current.preset.name}"
                        </button>
                    ) : (
                        <form
                            className="inline"
                            onSubmit={event => {
                                event.preventDefault();
                                const trimmed = presetName.trim();
                                void savePresets([
                                    ...savedPresets.filter(
                                        p => p.name !== trimmed
                                    ),
                                    { name: trimmed, selection }
                                ]).then(() => setPresetName(""));
                            }}
                        >
                            <input
                                aria-label="Preset name"
                                placeholder="Preset name"
                                value={presetName}
                                onChange={event =>
                                    setPresetName(event.target.value)
                                }
                            />
                            <button
                                type="submit"
                                disabled={
                                    !presetName.trim() || Boolean(current)
                                }
                            >
                                Save as preset
                            </button>
                        </form>
                    )}
                </fieldset>
                {error && <p className="field-error">{error}</p>}
            </div>
        </Modal>
    );
}
