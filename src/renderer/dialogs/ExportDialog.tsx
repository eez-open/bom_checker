import { useMemo, useState } from "react";
import {
    buildBomSheet,
    buildInfoSheet,
    builtInPresets,
    describeRowFilter,
    type ExportFormat,
    type ExportPreset,
    type ExportSelection,
    type RowFilter
} from "../../shared/export";
import { SUPPLIERS } from "../../shared/suppliers";
import { errorMessage } from "../errors";
import { documentName, useDocument } from "../store/document";
import { setAppSettings, useAppSettings } from "../store/settings";
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

export function ExportDialog({ onClose }: { onClose: () => void }) {
    const project = useDocument(state => state.project);
    const name = useDocument(state => documentName(state.filePath));
    const settings = useAppSettings(state => state.settings);
    const preference = settings.general.supplierOrder;
    const savedPresets = settings.general.exportPresets;
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

    // The preset the current selection matches, if any.
    const current = presets.find(p =>
        sameSelection(p.preset.selection, selection)
    );
    const bom = useMemo(
        () => buildBomSheet(project, preference, selection),
        [project, preference, selection]
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
                sheets
            });
            if (path) {
                setExportedTo(path);
            }
        } catch (caught) {
            setError(errorMessage(caught));
        }
    };

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
                        onClick={() => void runExport()}
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
                            {SUPPLIERS[supplier].name} part numbers and data
                        </label>
                    ))}
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
