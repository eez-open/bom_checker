// Actions shared by the menu, the toolbar and keyboard shortcuts.

import type { MenuCommand } from "../shared/ipc";
import {
    addRow as addRowToProject,
    createProject,
    createRow,
    deleteRows
} from "../shared/project-ops";
import { PROJECT_FILE_EXTENSION } from "../shared/project-file";
import { documentName, isDirty, useDocument } from "./store/document";
import { useUi } from "./store/ui";

export async function saveDocument(saveAs = false): Promise<boolean> {
    const { project, filePath, markSaved } = useDocument.getState();
    const savedPath = await window.api.project.save(project, {
        filePath,
        saveAs,
        suggestedName: suggestedFileName(project.source.path)
    });
    if (!savedPath) {
        return false;
    }
    markSaved(project, savedPath);
    return true;
}

/** "BOM example.csv" → "BOM example.eezbom" for a BOM that was imported. */
function suggestedFileName(sourcePath: string | undefined): string | undefined {
    const name = sourcePath?.split(/[\\/]/).pop();
    return name
        ? `${name.replace(/\.[^.]*$/, "")}.${PROJECT_FILE_EXTENSION}`
        : undefined;
}

/** Offers to save unsaved changes. Returns false if the user cancelled. */
export async function confirmDiscardChanges(): Promise<boolean> {
    const state = useDocument.getState();
    if (!isDirty(state)) {
        return true;
    }
    const choice = await window.api.dialog.askSaveChanges(
        documentName(state.filePath)
    );
    if (choice === "save") {
        return saveDocument();
    }
    return choice === "discard";
}

export async function newDocument(): Promise<void> {
    if (await confirmDiscardChanges()) {
        useDocument
            .getState()
            .load(createProject(), { filePath: null, saved: true });
    }
}

export async function openDocument(): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const opened = await window.api.project.open();
    if (opened) {
        useDocument
            .getState()
            .load(opened.project, { filePath: opened.filePath, saved: true });
    }
}

export async function importCsv(): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const file = await window.api.csv.open();
    if (file) {
        useUi.setState({ dialog: { kind: "csv-import", file } });
    }
}

/** Answers the "Save" choice of the prompt shown when closing the window. */
export async function saveAndClose(): Promise<void> {
    if (await saveDocument()) {
        window.api.window.closeConfirmed();
    }
}

export function addRow(): void {
    const row = createRow();
    useDocument.getState().edit(project => addRowToProject(project, row));
    useUi.setState({ editRowId: row.id });
}

export function deleteSelectedRows(): void {
    const ids = useUi.getState().selectedRowIds;
    if (ids.length > 0) {
        useDocument.getState().edit(project => deleteRows(project, ids));
    }
}

export function editColumns(): void {
    useUi.setState({ dialog: { kind: "columns" } });
}

export function openSettings(): void {
    useUi.setState({ dialog: { kind: "settings" } });
}

/** Forgets the unlocked credentials until the password is entered again. */
export async function lockCredentials(): Promise<void> {
    await window.api.vault.lock();
    if (useUi.getState().dialog?.kind === "settings") {
        closeDialog();
    }
}

export function closeDialog(): void {
    useUi.setState({ dialog: null });
}

/** Undo/redo the BOM edit, or the text edit while typing in a field. */
export function undo(): void {
    if (isTextEditing()) {
        document.execCommand("undo");
    } else {
        useDocument.getState().undo();
    }
}

export function redo(): void {
    if (isTextEditing()) {
        document.execCommand("redo");
    } else {
        useDocument.getState().redo();
    }
}

export function isTextEditing(): boolean {
    const element = document.activeElement;
    return (
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element instanceof HTMLSelectElement ||
        (element instanceof HTMLElement && element.isContentEditable)
    );
}

const MENU_COMMANDS: Record<MenuCommand, () => unknown> = {
    new: newDocument,
    open: openDocument,
    save: () => saveDocument(),
    "save-as": () => saveDocument(true),
    "import-csv": importCsv,
    undo,
    redo,
    "add-row": addRow,
    "delete-rows": deleteSelectedRows,
    "edit-columns": editColumns,
    settings: openSettings,
    lock: lockCredentials,
    "save-and-close": saveAndClose
};

export function runMenuCommand(command: MenuCommand): void {
    Promise.resolve(MENU_COMMANDS[command]()).catch((error: unknown) =>
        console.error(`Command "${command}" failed`, error)
    );
}
