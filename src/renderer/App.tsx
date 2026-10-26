import { useEffect, useState } from "react";
import type { AppInfo } from "../shared/ipc";
import { setCell, totalQuantity } from "../shared/project-ops";
import {
    closeDialog,
    isTextEditing,
    redo,
    runMenuCommand,
    undo
} from "./commands";
import { ColumnsDialog } from "./dialogs/ColumnsDialog";
import { CollectDialog } from "./dialogs/CollectDialog";
import { CsvImportDialog } from "./dialogs/CsvImportDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { documentName, isDirty, useDocument } from "./store/document";
import { useUi } from "./store/ui";
import { BomTable } from "./table/BomTable";
import { Toolbar } from "./Toolbar";

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function App() {
    const project = useDocument(state => state.project);
    const name = useDocument(state => documentName(state.filePath));
    const dirty = useDocument(isDirty);
    const editRowId = useUi(state => state.editRowId);
    const dialog = useUi(state => state.dialog);
    const [info, setInfo] = useState<AppInfo>();

    useEffect(() => {
        window.api.app
            .getInfo()
            .then(setInfo)
            .catch((error: unknown) =>
                console.error("Failed to get app info", error)
            );
    }, []);

    useEffect(() => window.api.onMenuCommand(runMenuCommand), []);

    useEffect(() => {
        // Ctrl+Z / Ctrl+Y undo BOM edits; inside text fields the browser's
        // own undo applies (see Edit menu in main/menu.ts).
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || isTextEditing()) {
                return;
            }
            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey) {
                event.preventDefault();
                undo();
            } else if (key === "y" || (key === "z" && event.shiftKey)) {
                event.preventDefault();
                redo();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        document.title = `${dirty ? "*" : ""}${name} - EEZ BOM checker`;
        window.api.window.setDocumentState({ name, dirty });
    }, [name, dirty]);

    return (
        <div className="app">
            <Toolbar />
            <main className="app-table">
                <BomTable
                    project={project}
                    editRowId={editRowId}
                    onEditStarted={() => useUi.setState({ editRowId: null })}
                    onCellEdit={(rowId, key, value) =>
                        useDocument
                            .getState()
                            .edit(p => setCell(p, rowId, key, value))
                    }
                    onSelectionChange={ids =>
                        useUi.setState({ selectedRowIds: ids })
                    }
                />
            </main>
            <footer className="status-bar">
                <span data-testid="bom-summary">
                    {count(project.rows.length, "row")} ·{" "}
                    {count(totalQuantity(project), "part")}
                </span>
                <span data-testid="app-version">
                    {info ? `v${info.version}` : ""}
                </span>
            </footer>
            {dialog?.kind === "columns" && (
                <ColumnsDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "csv-import" && (
                <CsvImportDialog file={dialog.file} onClose={closeDialog} />
            )}
            {dialog?.kind === "collect" && (
                <CollectDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "settings" && (
                <SettingsDialog onClose={closeDialog} />
            )}
        </div>
    );
}
