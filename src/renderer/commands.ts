// Actions shared by the menu, the toolbar and keyboard shortcuts.

import {
    COLUMN_GROUPS,
    type ColumnGroup,
    type MenuCommand,
    type OpenedDocument,
    type OpenedProject
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
import { collectedKeysOf, withoutResults } from "../shared/collection";
import { importedKicadValues } from "../shared/kicad-sync";
import { PROJECT_FILE_EXTENSION } from "../shared/project-file";
import {
    addBomsToList,
    afterListSave,
    closeList,
    confirmDiscardList,
    forgetInList,
    isListOpen,
    loadList,
    saveAllInList,
    unsavedPaths
} from "./list-commands";
import { documentName, isDirty, useDocument } from "./store/document";
import {
    resetTableView,
    setHiddenColumns,
    setTableLayout,
    setTableTab,
    useUi,
    type TableGroup
} from "./store/ui";
import { COMBINED, useWorkspace } from "./store/workspace";

export async function saveDocument(saveAs = false): Promise<boolean> {
    const { project, filePath, markSaved, readOnly } = useDocument.getState();
    if (readOnly) {
        return true;
    }
    // The BOMs of a list keep their files.
    const inList = isListOpen();
    const savedPath = await window.api.project.save(project, {
        filePath,
        saveAs: saveAs && !inList,
        suggestedName: suggestedFileName(project.source),
        recent: !inList
    });
    if (!savedPath) {
        return false;
    }
    markSaved(project, savedPath);
    if (inList) {
        await afterListSave(savedPath);
    }
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
    if (isListOpen()) {
        return confirmDiscardList();
    }
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

/** Shows a single BOM, closing an open list. */
function loadDocument(
    project: Project,
    filePath: string | null,
    saved = true
): void {
    closeList();
    useDocument.getState().load(project, { filePath, saved });
    resetTableView();
}

/** A file that still has supplier data opens with unsaved changes, so
 *  saving it removes the data. */
function loadOpened({
    filePath,
    project,
    supplierDataInFile
}: OpenedProject): void {
    loadDocument(project, filePath, !supplierDataInFile);
}

export async function newDocument(): Promise<void> {
    if (await confirmDiscardChanges()) {
        loadDocument(createProject(), null);
    }
}

/** File → New BOM List… (#35). */
export async function newList(): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const opened = await window.api.list.create();
    if (opened) {
        loadList(opened);
    }
}

function openDocumentOrList(
    opened: Extract<OpenedDocument, { kind: "project" | "list" }>
): void {
    if (opened.kind === "list") {
        loadList(opened.list);
    } else {
        loadOpened(opened.opened);
    }
}

export async function openDocument(): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const opened = await window.api.project.open();
    if (opened) {
        openDocumentOrList(opened);
    }
}

/** Back to the start page, after offering to save. */
export async function closeDocument(): Promise<void> {
    if (await confirmDiscardChanges()) {
        closeList();
        useDocument.getState().close();
        resetTableView();
    }
}

/** Opens a BOM or a list, or starts importing a CSV file or KiCad project:
 *  from the recent documents, or a file dropped on the window. */
export async function openPath(path: string): Promise<void> {
    if (!(await confirmDiscardChanges())) {
        return;
    }
    const opened = await window.api.files.openPath(path);
    switch (opened?.kind) {
        case "project":
        case "list":
            openDocumentOrList(opened);
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
    closeList();
    resetTableView();
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
    if (await (isListOpen() ? saveAllInList() : saveDocument())) {
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

/** The collected data of the selected rows (#40), for every supplier. */
export function selectedRowsData(): ReturnType<typeof collectedKeysOf> {
    const { project } = useDocument.getState();
    return collectedKeysOf(project, new Set(useUi.getState().selectedRowIds));
}

/**
 * Forgets the data collected for the selected rows, after asking: e.g. to
 * collect them again from scratch. It isn't an undo step, like collecting.
 */
export async function forgetSelectedData(): Promise<void> {
    const { keys, rows } = selectedRowsData();
    if (rows === 0) {
        return;
    }
    const confirmed = await window.api.dialog.confirm({
        message:
            rows === 1
                ? "Forget the supplier data of the selected row?"
                : `Forget the supplier data of ${rows} selected rows?`,
        detail:
            "Stock, prices and the rest collected for their part numbers are " +
            "removed, also from other rows with the same part numbers. This " +
            "can't be undone; collect them again to get the data back.",
        confirmLabel: "Forget"
    });
    if (!confirmed) {
        return;
    }
    useDocument
        .getState()
        .applyCollected(collected => withoutResults(collected, keys));
    if (useWorkspace.getState().selected === COMBINED) {
        forgetInList(keys);
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

/** Shows or hides a column group; with tabs (#41), shows its tab. */
export function toggleColumns(group: TableGroup): void {
    const { hiddenColumns: hidden, tableLayout } = useUi.getState();
    if (tableLayout === "tabs") {
        setTableTab(group);
        return;
    }
    setHiddenColumns(
        hidden.includes(group)
            ? hidden.filter(g => g !== group)
            : [...hidden, group]
    );
}

/** Every column group side by side, or each on a tab of its own (#41). */
export function toggleTableLayout(): void {
    setTableLayout(
        useUi.getState().tableLayout === "tabs" ? "columns" : "tabs"
    );
}

export function showAllColumns(): void {
    setHiddenColumns([]);
}

/** Collecting and exporting need rows (#38); also for the shortcuts. */
function hasRows(): boolean {
    return useDocument.getState().project.rows.length > 0;
}

export function openExport(): void {
    if (hasRows()) {
        useUi.setState({ dialog: { kind: "export" } });
    }
}

export function openCostChart(): void {
    useUi.setState({ dialog: { kind: "cost-chart" } });
}

/** The selected rows of the BOM shown, or all, against the list's history
 *  (#52). */
export function checkHistory(): void {
    const { list, selected } = useWorkspace.getState();
    const { open, readOnly, project } = useDocument.getState();
    if (
        !list?.history ||
        !selected ||
        selected === COMBINED ||
        selected === list.history ||
        !open ||
        readOnly ||
        project.rows.length === 0
    ) {
        return;
    }
    const rowIds = useUi.getState().selectedRowIds;
    useUi.setState({
        dialog: {
            kind: "check-history",
            rowIds: rowIds.length > 0 ? rowIds : null
        }
    });
}

/** What each BOM of the list costs (#54). */
export function openBomCosts(): void {
    if (isListOpen()) {
        useUi.setState({ dialog: { kind: "bom-costs" } });
    }
}

export function openCollect(): void {
    if (hasRows()) {
        useUi.setState({ dialog: { kind: "collect" } });
    }
}

/** Tools → Unify Part Numbers… of a BOM list (#35). It changes the BOM
 *  files, so it starts from saved BOMs. */
export async function openUnify(): Promise<void> {
    if (!isListOpen()) {
        return;
    }
    if (unsavedPaths().length > 0) {
        const save = await window.api.dialog.confirm({
            message: "Save the changed BOMs first?",
            detail: "Unify changes the BOM files, so it starts from the saved BOMs.",
            confirmLabel: "Save All"
        });
        if (!save || !(await saveAllInList())) {
            return;
        }
    }
    useUi.setState({ dialog: { kind: "unify" } });
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
    "new-list": newList,
    open: openDocument,
    close: closeDocument,
    save: () => saveDocument(),
    "save-as": () => saveDocument(true),
    "save-all": saveAllInList,
    "add-boms": addBomsToList,
    unify: openUnify,
    "check-history": checkHistory,
    "import-csv": importCsv,
    "import-kicad": importKicad,
    export: openExport,
    "update-kicad": updateKicad,
    find,
    "cost-chart": openCostChart,
    "bom-costs": openBomCosts,
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
    "toggle-tabs": toggleTableLayout,
    settings: openSettings,
    collect: openCollect,
    "forget-data": forgetSelectedData,
    lock: lockCredentials,
    "save-and-close": saveAndClose
};

/** Commands that work without an open BOM, e.g. on the start page. */
const WITHOUT_DOCUMENT = new Set<MenuCommand>([
    "new",
    "new-list",
    "open",
    "import-csv",
    "import-kicad",
    "settings",
    "lock"
]);

/** Commands of an open list, also when it shows no BOM (#35). */
const LIST_COMMANDS = new Set<MenuCommand>([
    "close",
    "save-all",
    "add-boms",
    "unify",
    "bom-costs"
]);

export function runMenuCommand(command: MenuCommand): void {
    // The menu disables the others too; this also covers their shortcuts.
    const available =
        useDocument.getState().open ||
        WITHOUT_DOCUMENT.has(command) ||
        (isListOpen() && LIST_COMMANDS.has(command));
    if (!available) {
        return;
    }
    Promise.resolve(MENU_COMMANDS[command]()).catch((error: unknown) =>
        console.error(`Command "${command}" failed`, error)
    );
}
