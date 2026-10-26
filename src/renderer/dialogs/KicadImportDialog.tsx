import { useMemo, useState } from "react";
import {
    importTable,
    suggestMapping,
    type ColumnTarget
} from "../../shared/csv-import";
import type { KicadProjectData } from "../../shared/ipc";
import { rememberMapping } from "../import/remembered-mappings";
import { loadImported } from "../commands";
import { ColumnMappingTable, useColumnMapping } from "./ColumnMapping";
import { Modal } from "./Modal";

const BASE_HEADERS = new Set(["Reference", "Value", "Qty", "Footprint"]);

interface KicadImportDialogProps {
    project: KicadProjectData;
    onClose: () => void;
}

export function KicadImportDialog({
    project,
    onClose
}: KicadImportDialogProps) {
    const [variantName, setVariantName] = useState(project.variants[0]!.name);
    const variant =
        project.variants.find(v => v.name === variantName) ??
        project.variants[0]!;
    const table = variant.table;

    // Fields the project's own BOM settings hide (Datasheet, Description…)
    // start as "Don't import".
    const suggest = (headers: readonly string[]): ColumnTarget[] =>
        suggestMapping(headers).map((target, index) =>
            project.bomFields &&
            target.kind === "custom" &&
            !BASE_HEADERS.has(headers[index]!) &&
            !project.bomFields.includes(headers[index]!)
                ? { kind: "ignore" }
                : target
        );
    const { mapping, setTarget, errors } = useColumnMapping(table, suggest);

    const preview = useMemo(
        () =>
            errors.length > 0
                ? null
                : importTable(table, mapping, {
                      kind: "kicad",
                      path: project.path
                  }),
        [errors.length, table, mapping, project.path]
    );

    const runImport = () => {
        const { project: imported } = importTable(table, mapping, {
            kind: "kicad",
            path: project.path,
            variant: variant.name,
            importedAt: new Date().toISOString()
        });
        rememberMapping(table.headers, mapping);
        loadImported(imported);
        onClose();
    };

    const warnings = [...project.warnings, ...variant.warnings];

    return (
        <Modal
            title={`Import ${project.name}`}
            size="large"
            onClose={onClose}
            footer={
                <>
                    <span className="modal-footer-info">
                        {preview &&
                            `${preview.project.rows.length} rows · ${variant.partCount} parts`}
                    </span>
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="primary"
                        disabled={!preview}
                        onClick={runImport}
                    >
                        Import
                    </button>
                </>
            }
        >
            {project.variants.length > 1 && (
                <fieldset className="variant-choice">
                    <legend>Design variant</legend>
                    {project.variants.map(option => (
                        <label key={option.name}>
                            <input
                                type="radio"
                                name="variant"
                                checked={option.name === variant.name}
                                onChange={() => setVariantName(option.name)}
                            />
                            {option.name}{" "}
                            <span className="muted">
                                ({option.partCount} parts)
                            </span>
                        </label>
                    ))}
                </fieldset>
            )}
            <p className="muted">
                Symbols marked DNP or "Exclude from bill of materials" in this
                variant are left out.
            </p>
            {warnings.map(warning => (
                <p key={warning} className="warning">
                    {warning}
                </p>
            ))}
            <ColumnMappingTable
                table={table}
                mapping={mapping}
                columnLabel="KiCad field"
                onChange={setTarget}
            />
            {errors.map(error => (
                <p key={error} className="field-error">
                    {error}
                </p>
            ))}
            {preview?.warnings.map(warning => (
                <p key={warning} className="warning">
                    {warning}
                </p>
            ))}
        </Modal>
    );
}
