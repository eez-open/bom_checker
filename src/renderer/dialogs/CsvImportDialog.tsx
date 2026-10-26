import { useMemo, useState } from "react";
import {
    decodeText,
    detectEncoding,
    ENCODINGS,
    importTable,
    parseCsv,
    type Encoding
} from "../../shared/csv-import";
import type { OpenedFile } from "../../shared/ipc";
import { rememberMapping } from "../import/remembered-mappings";
import { loadImported } from "../commands";
import { ColumnMappingTable, useColumnMapping } from "./ColumnMapping";
import { Modal } from "./Modal";

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
    const { mapping, setTarget, errors } = useColumnMapping(table);

    const preview = useMemo(
        () =>
            errors.length > 0
                ? null
                : importTable(table, mapping, {
                      kind: "csv",
                      path: file.filePath
                  }),
        [errors.length, table, mapping, file.filePath]
    );

    const runImport = () => {
        const { project } = importTable(table, mapping, {
            kind: "csv",
            path: file.filePath,
            importedAt: new Date().toISOString()
        });
        rememberMapping(table.headers, mapping);
        loadImported(project);
        onClose();
    };

    return (
        <Modal
            title={`Import ${file.fileName}`}
            name="csv-import"
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
            <ColumnMappingTable
                table={table}
                mapping={mapping}
                columnLabel="CSV column"
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
