// Actions shared by the menu, the toolbar and keyboard shortcuts.

import {
    COLUMN_GROUPS,
    type ColumnGroup,
    type MenuCommand
} from "../shared/ipc";
import {
    partNumberKey,
    type Project,
    type ProjectSource,
    type SupplierId,
    type SupplierOffer
} from "../shared/model";
import {
    addRow as addRowToProject,
    createProject,
    createRow,
    deleteRows,
    replacePartNumber
} from "../shared/project-ops";
import { importedKicadValues } from "../shared/kicad-sync";
import { PROJECT_FILE_EXTENSION } from "../shared/project-file";
import { documentName, isDirty, useDocument } from "./store/document";
import { setHiddenColumns, useUi } from "./store/ui";

export async function saveDocument(saveAs = false): Promise<boolean> {
    const { project, filePath, markSaved } = useDocument.getState();
    const savedPath = await window.api.project.save(project, {
        filePath,
        saveAs,
        suggestedName: suggestedFileName(project.source)
    });
    if (!savedPath) {
        return false;
    }
    markSaved(project, savedPath);
    return true;
}

/** "BOM example.csv" → "BOM example.eezbom" for an imported BOM; a KiCad
 *  design variant other than the default is added: "Board (Basic).eezbom". */
function suggestedFileName(source: ProjectSource): string | undefined {
    const name = source.path
        ?.split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]*$/, "");
    if (!name) {
        return undefined;
    }
    const variant =
        source.variant && source.variant !== "Default"
            ? ` (${source.variant})`
            : "";
    return `${name}${variant}.${PROJECT_FILE_EXTENSION}`;
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
        resetView();
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
        resetView();
    }
}

/** Back to the start page, after offering to save. */
export async function closeDocument(): Promise<void> {
    if (await confirmDiscardChanges()) {
        useDocument.getState().close();
        resetView();
    }
}

/** Opens a BOM, or starts importing a CSV file or KiCad project: from the
 *  recent documents, or a file dropped on the window. */
export async function openPath(path: string): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const opened = await window.api.files.openPath(path);
    switch (opened?.kind) {
        case "project":
            useDocument.getState().load(opened.opened.project, {
                filePath: opened.opened.filePath,
                saved: true
            });
            resetView();
            break;
        case "csv":
            useUi.setState({
                dialog: { kind: "csv-import", file: opened.file }
            });
            break;
        case "kicad":
            useUi.setState({
                dialog: { kind: "kicad-import", project: opened.project }
            });
            break;
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

/**
 * Loads an imported BOM. Supplier data already collected is kept: results
 * are stored per part number, so part numbers that are still in the BOM
 * don't need to be collected again.
 */
export function loadImported(project: Project): void {
    const { project: current, load } = useDocument.getState();
    resetView();
    load(
        {
            ...project,
            // What KiCad had, for Sync KiCad… later.
            source:
                project.source.kind === "kicad"
                    ? {
                          ...project.source,
                          kicadValues: importedKicadValues(project)
                      }
                    : project.source,
            buildQuantity: current.buildQuantity,
            collected: {
                ...project.collected,
                results: current.collected.results
            }
        },
        { filePath: null, saved: false }
    );
}

export async function importKicad(): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const project = await window.api.kicad.open();
    if (project) {
        useUi.setState({ dialog: { kind: "kicad-import", project } });
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

/** Brings changes made in KiCad since the import into the BOM. */
export function syncKicad(): void {
    const { source } = useDocument.getState().project;
    if (source.kind === "kicad" && source.path) {
        useUi.setState({ dialog: { kind: "kicad-sync" } });
    }
}

/** The search field above the table. */
export const SEARCH_INPUT_ID = "bom-search";

/** Ctrl+F: to the search field above the table. */
export function find(): void {
    const input = document.getElementById(SEARCH_INPUT_ID);
    if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
    }
}

export function clearFilters(): void {
    useUi.setState({ search: "", rowView: "all" });
}

/** Another BOM starts unfiltered and with no rows selected. */
function resetView(): void {
    clearFilters();
    useUi.setState({ selectedRowIds: [], shownRows: null });
}

/** Writes part numbers back into the KiCad project the BOM came from. */
export function updateKicad(): void {
    const { source } = useDocument.getState().project;
    if (source.kind === "kicad" && source.path) {
        useUi.setState({ dialog: { kind: "kicad-update" } });
    }
}

/**
 * One of several items that matched part number `key` was chosen: its own
 * part number replaces `key` in every row that has it. Its data is already
 * known, so it needn't be looked up again.
 */
export function chooseItem(
    supplier: SupplierId,
    key: string,
    offer: SupplierOffer
): void {
    const { project, applyCollected, edit } = useDocument.getState();
    const result = project.collected.results[supplier]?.[key];
    if (result?.status !== "ambiguous") {
        return;
    }
    applyCollected(collected => ({
        ...collected,
        results: {
            ...collected.results,
            [supplier]: {
                ...collected.results[supplier],
                [partNumberKey(offer.supplierPartNumber)]: {
                    status: "found",
                    offer,
                    matchedBy: "supplierPartNumber",
                    runId: result.runId,
                    fetchedAt: result.fetchedAt
                }
            }
        }
    }));
    edit(current =>
        replacePartNumber(current, supplier, key, offer.supplierPartNumber)
    );
}

export function editColumns(): void {
    useUi.setState({ dialog: { kind: "columns" } });
}

export function toggleColumns(group: ColumnGroup): void {
    const hidden = useUi.getState().hiddenColumns;
    setHiddenColumns(
        hidden.includes(group)
            ? hidden.filter(g => g !== group)
            : [...hidden, group]
    );
}

export function showAllColumns(): void {
    setHiddenColumns([]);
}

export function openExport(): void {
    useUi.setState({ dialog: { kind: "export" } });
}

export function openCollect(): void {
    useUi.setState({ dialog: { kind: "collect" } });
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
    close: closeDocument,
    save: () => saveDocument(),
    "save-as": () => saveDocument(true),
    "import-csv": importCsv,
    "import-kicad": importKicad,
    export: openExport,
    "update-kicad": updateKicad,
    find,
    "sync-kicad": syncKicad,
    undo,
    redo,
    "add-row": addRow,
    "delete-rows": deleteSelectedRows,
    "edit-columns": editColumns,
    ...(Object.fromEntries(
        COLUMN_GROUPS.map(group => [
            `toggle-columns:${group}`,
            () => toggleColumns(group)
        ])
    ) as Record<`toggle-columns:${ColumnGroup}`, () => void>),
    "show-all-columns": showAllColumns,
    settings: openSettings,
    collect: openCollect,
    lock: lockCredentials,
    "save-and-close": saveAndClose
};

/** Commands that work without an open BOM, e.g. on the start page. */
const WITHOUT_DOCUMENT = new Set<MenuCommand>([
    "new",
    "open",
    "import-csv",
    "import-kicad",
    "settings",
    "lock"
]);

export function runMenuCommand(command: MenuCommand): void {
    // The menu disables the others too; this also covers their shortcuts.
    if (!useDocument.getState().open && !WITHOUT_DOCUMENT.has(command)) {
        return;
    }
    Promise.resolve(MENU_COMMANDS[command]()).catch((error: unknown) =>
        console.error(`Command "${command}" failed`, error)
    );
}
