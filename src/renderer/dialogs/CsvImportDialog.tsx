import { useMemo, useState } from "react";
import {
    decodeText,
    detectEncoding,
    ENCODINGS,
    importCsv,
    parseCsv,
    suggestMapping,
    targetId,
    validateMapping,
    type ColumnTarget,
    type CsvTable,
    type Encoding
} from "../../shared/csv-import";
import type { OpenedFile } from "../../shared/ipc";
import { ALL_SUPPLIERS } from "../../shared/suppliers";
import {
    rememberedTargetIds,
    rememberMapping
} from "../import/remembered-mappings";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

const TARGET_OPTIONS: { label: string; target: ColumnTarget }[] = [
    { label: "Don't import", target: { kind: "ignore" } },
    { label: "Row number (renumbered)", target: { kind: "row" } },
    { label: "Reference", target: { kind: "base", field: "reference" } },
    { label: "Value", target: { kind: "base", field: "value" } },
    { label: "Qty", target: { kind: "base", field: "qty" } },
    { label: "Footprint", target: { kind: "base", field: "footprint" } },
    ...ALL_SUPPLIERS.map(supplier => ({
        label: `${supplier.name} part number`,
        target: { kind: "partNumber", supplier: supplier.id } as const
    })),
    { label: "Custom column (text)", target: { kind: "custom", type: "text" } },
    {
        label: "Custom column (number)",
        target: { kind: "custom", type: "number" }
    }
];

const TARGETS_BY_ID = new Map(
    TARGET_OPTIONS.map(option => [targetId(option.target), option.target])
);

function initialMapping(headers: readonly string[]): ColumnTarget[] {
    const remembered = rememberedTargetIds(headers)?.map(id =>
        TARGETS_BY_ID.get(id)
    );
    return remembered?.every(target => target !== undefined)
        ? remembered
        : suggestMapping(headers);
}

/** Up to three different example values from a column. */
function examples(table: CsvTable, column: number): string {
    const values = new Set<string>();
    for (const row of table.rows) {
        const value = row[column]?.trim();
        if (value) {
            values.add(value.length > 30 ? `${value.slice(0, 29)}…` : value);
        }
        if (values.size === 3) {
            break;
        }
    }
    return [...values].join(" · ");
}

interface CsvImportDialogProps {
    file: OpenedFile;
    onClose: () => void;
}

export function CsvImportDialog({ file, onClose }: CsvImportDialogProps) {
    const [encoding, setEncoding] = useState<Encoding>(() =>
        detectEncoding(file.bytes)
    );
    const table = useMemo(
        () => parseCsv(decodeText(file.bytes, encoding)),
        [file.bytes, encoding]
    );
    // The mapping belongs to one set of headers; a different encoding can
    // change them, and then the mapping starts over.
    const headersKey = JSON.stringify(table.headers);
    const [state, setState] = useState(() => ({
        headersKey,
        mapping: initialMapping(table.headers)
    }));
    const mapping =
        state.headersKey === headersKey
            ? state.mapping
            : initialMapping(table.headers);

    const errors = validateMapping(mapping);
    const preview = useMemo(
        () =>
            errors.length > 0
                ? null
                : importCsv(table, mapping, {
                      path: file.filePath,
                      importedAt: ""
                  }),
        [errors.length, table, mapping, file.filePath]
    );

    const setTarget = (column: number, id: string) => {
        const target = TARGETS_BY_ID.get(id);
        if (target) {
            setState({
                headersKey,
                mapping: mapping.map((t, i) => (i === column ? target : t))
            });
        }
    };

    const runImport = () => {
        const { project } = importCsv(table, mapping, {
            path: file.filePath,
            importedAt: new Date().toISOString()
        });
        rememberMapping(table.headers, mapping);
        useDocument.getState().load(project, { filePath: null, saved: false });
        onClose();
    };

    return (
        <Modal
            title={`Import ${file.fileName}`}
            onClose={onClose}
            footer={
                <>
                    <span className="modal-footer-info">
                        {preview && `${preview.project.rows.length} rows`}
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
            <label className="field">
                Text encoding
                <select
                    value={encoding}
                    onChange={event =>
                        setEncoding(event.target.value as Encoding)
                    }
                >
                    {ENCODINGS.map(option => (
                        <option key={option.id} value={option.id}>
                            {option.label}
                        </option>
                    ))}
                </select>
            </label>
            <table className="mapping">
                <thead>
                    <tr>
                        <th>CSV column</th>
                        <th>Examples</th>
                        <th>Import as</th>
                    </tr>
                </thead>
                <tbody>
                    {table.headers.map((header, column) => (
                        <tr key={column}>
                            <td>{header || <em>(no header)</em>}</td>
                            <td className="muted">{examples(table, column)}</td>
                            <td>
                                <select
                                    aria-label={`Import "${header}" as`}
                                    value={targetId(mapping[column]!)}
                                    onChange={event =>
                                        setTarget(column, event.target.value)
                                    }
                                >
                                    {TARGET_OPTIONS.map(option => (
                                        <option
                                            key={targetId(option.target)}
                                            value={targetId(option.target)}
                                        >
                                            {option.label}
                                        </option>
                                    ))}
                                </select>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
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
