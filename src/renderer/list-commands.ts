// BOM lists (#35): the list on the left and its BOMs. The selected BOM is
// in useDocument like a single open BOM, so everything else works on it
// unchanged; the others wait in useWorkspace with their unsaved changes
// and undo history.

import {
    fileTitle,
    usedPartNumbers,
    withNewerResults,
    type ListMember
} from "../shared/bom-list";
import { withoutResults, type ResultKeys } from "../shared/collection";
import { combineBoms } from "../shared/combined-bom";
import type { OpenedList } from "../shared/ipc";
import type {
    CollectedData,
    LookupResult,
    Project,
    SupplierId
} from "../shared/model";
import { addToHistory } from "../shared/parts-history";
import type { UnifyChanges } from "../shared/unify";
import { errorMessage } from "./errors";
import {
    isDirty,
    snapshotOf,
    useDocument,
    type DocumentSnapshot
} from "./store/document";
import { resetTableView } from "./store/ui";
import { COMBINED, useWorkspace } from "./store/workspace";

/** A BOM as read; one whose file still has supplier data has unsaved
 *  changes, so saving it removes the data. */
function fresh(
    project: Project,
    supplierDataInFile?: boolean
): DocumentSnapshot {
    return {
        project,
        savedProject: supplierDataInFile ? null : project,
        past: [],
        future: []
    };
}

export function isListOpen(): boolean {
    return useWorkspace.getState().list !== null;
}

/** The current state of a BOM of the list, shown or not. */
export function documentOf(path: string): DocumentSnapshot | undefined {
    const { selected, documents } = useWorkspace.getState();
    return selected === path
        ? snapshotOf(useDocument.getState())
        : documents[path];
}

function setDocument(path: string, snapshot: DocumentSnapshot): void {
    if (useWorkspace.getState().selected === path) {
        useDocument.setState(snapshot);
    } else {
        useWorkspace.setState(state => ({
            documents: { ...state.documents, [path]: snapshot }
        }));
    }
}

/** The list's BOMs and history that could be read. */
function readablePaths(): string[] {
    const { list, errors } = useWorkspace.getState();
    if (!list) {
        return [];
    }
    return [...list.boms, ...(list.history ? [list.history] : [])].filter(
        path => !errors[path]
    );
}

/** The list's BOMs that could be read, as they are now (not the history). */
export function listMembers(): ListMember[] {
    const { list, errors } = useWorkspace.getState();
    return (list?.boms ?? []).flatMap(path => {
        const document = errors[path] ? undefined : documentOf(path);
        return document
            ? [{ path, name: fileTitle(path), project: document.project }]
            : [];
    });
}

export function unsavedPaths(): string[] {
    return readablePaths().filter(path => {
        const document = documentOf(path);
        return document !== undefined && isDirty(document);
    });
}

export function loadList(opened: OpenedList): void {
    const documents: Record<string, DocumentSnapshot> = {};
    const errors: Record<string, string> = {};
    const all = [...opened.boms, ...(opened.history ? [opened.history] : [])];
    for (const bom of all) {
        if (bom.project) {
            documents[bom.path] = fresh(bom.project, bom.supplierDataInFile);
        } else {
            errors[bom.path] = bom.error ?? "The file can't be read.";
        }
    }
    useDocument.getState().close();
    useWorkspace.setState({
        list: {
            filePath: opened.filePath,
            boms: opened.boms.map(bom => bom.path),
            history: opened.history?.path ?? null
        },
        documents,
        errors,
        selected: null,
        message: null
    });
    selectInList(opened.boms[0]?.path ?? null);
}

export function closeList(): void {
    useWorkspace.setState({
        list: null,
        documents: {},
        errors: {},
        selected: null,
        message: null
    });
    useDocument.getState().close();
    resetTableView();
}

/** Shows a BOM of the list, COMBINED, or nothing (null). */
export function selectInList(target: string | null): void {
    const { list, selected, documents } = useWorkspace.getState();
    if (!list || (target === selected && target !== null)) {
        return;
    }
    // The shown BOM waits with its unsaved changes and undo history.
    const waiting = { ...documents };
    const shown = useDocument.getState();
    if (selected && selected !== COMBINED && shown.open) {
        waiting[selected] = snapshotOf(shown);
    }
    resetTableView();

    if (target === COMBINED) {
        useWorkspace.setState({ documents: waiting, selected: target });
        showCombined();
        return;
    }
    const snapshot = target ? waiting[target] : undefined;
    if (target && snapshot) {
        delete waiting[target];
        useWorkspace.setState({ documents: waiting, selected: target });
        useDocument.getState().restore(snapshot, target);
    } else {
        useWorkspace.setState({ documents: waiting, selected: target });
        useDocument.getState().close();
    }
}

/** Shows the Combined BOM of the BOMs as they are now. */
function showCombined(): void {
    useDocument.getState().load(combineBoms(listMembers()), {
        filePath: null,
        saved: true,
        readOnly: true
    });
}

/** Data collected in the Combined BOM goes to the BOMs that use the part
 *  numbers, where it's newer; they then have unsaved changes. */
function shareCollected(collected: CollectedData): void {
    const { list, documents } = useWorkspace.getState();
    if (!list) {
        return;
    }
    let changed = false;
    const next = { ...documents };
    for (const path of list.boms) {
        const document = documents[path];
        if (!document) {
            continue;
        }
        const project = withNewerResults(
            document.project,
            collected,
            usedPartNumbers(document.project)
        );
        if (project !== document.project) {
            next[path] = { ...document, project };
            changed = true;
        }
    }
    if (changed) {
        useWorkspace.setState({ documents: next });
    }
}

/** Results forgotten in the Combined BOM (#40) are forgotten in the BOMs
 *  too, since Combined shows theirs; they then have unsaved changes. */
export function forgetInList(keys: ResultKeys): void {
    const { list, documents } = useWorkspace.getState();
    if (!list) {
        return;
    }
    const next = { ...documents };
    for (const path of list.boms) {
        const document = documents[path];
        if (!document) {
            continue;
        }
        const collected = withoutResults(document.project.collected, keys);
        if (collected !== document.project.collected) {
            next[path] = {
                ...document,
                project: { ...document.project, collected }
            };
        }
    }
    useWorkspace.setState({ documents: next });
}

/** The results of `next` that `before` doesn't have. */
function newResults(next: CollectedData, before: CollectedData): CollectedData {
    const results: CollectedData["results"] = {};
    for (const [supplier, theirs] of Object.entries(next.results) as [
        SupplierId,
        Record<string, LookupResult>
    ][]) {
        for (const [key, result] of Object.entries(theirs)) {
            if (before.results[supplier]?.[key] !== result) {
                (results[supplier] ??= {})[key] = result;
            }
        }
    }
    return { results, runs: {} };
}

// Only what is collected while Combined is shown: showing it, which merges
// the BOMs' data, mustn't change them.
useDocument.subscribe((state, previous) => {
    if (
        state.readOnly &&
        previous.readOnly &&
        state.project.rows === previous.project.rows &&
        state.project.collected !== previous.project.collected &&
        useWorkspace.getState().selected === COMBINED
    ) {
        shareCollected(
            newResults(state.project.collected, previous.project.collected)
        );
    }
});

function showMessage(message: string | null): void {
    useWorkspace.setState({ message });
}

async function saveListFile(): Promise<void> {
    const { list } = useWorkspace.getState();
    if (!list) {
        return;
    }
    try {
        await window.api.list.save(list.filePath, list.boms, list.history);
    } catch (error) {
        showMessage(`The list couldn't be saved: ${errorMessage(error)}`);
    }
}

/** Saves one BOM of the list; false if that failed (main said why). */
async function saveListBom(path: string): Promise<boolean> {
    const document = documentOf(path);
    if (!document) {
        return true;
    }
    const saved = await window.api.project.save(document.project, {
        filePath: path,
        saveAs: false,
        recent: false
    });
    if (!saved) {
        return false;
    }
    // It may have changed while saving.
    setDocument(path, { ...documentOf(path)!, savedProject: document.project });
    return true;
}

/**
 * The history BOM gets the components and part numbers of `paths` that it
 * doesn't have. It's saved, unless it has other unsaved changes.
 */
export async function updateHistory(paths: readonly string[]): Promise<void> {
    const { list, errors } = useWorkspace.getState();
    const history = list?.history;
    const document = history && !errors[history] && documentOf(history);
    if (!history || !document) {
        return;
    }
    const boms = paths.flatMap(path => {
        const bom = path === history ? undefined : documentOf(path);
        return bom ? [{ name: fileTitle(path), project: bom.project }] : [];
    });
    const { project } = addToHistory(document.project, boms);
    if (project === document.project) {
        return;
    }
    const clean = !isDirty(document);
    setDocument(history, {
        ...document,
        project,
        past: [...document.past, document.project],
        future: []
    });
    if (clean) {
        await saveListBom(history);
    }
}

/** Saves every BOM of the list with unsaved changes; false if one failed. */
export async function saveAllInList(): Promise<boolean> {
    const history = useWorkspace.getState().list?.history;
    const saved: string[] = [];
    for (const path of unsavedPaths()) {
        if (!(await saveListBom(path))) {
            return false;
        }
        saved.push(path);
    }
    await updateHistory(saved.filter(path => path !== history));
    return true;
}

/** After the shown BOM was saved with File → Save. */
export async function afterListSave(path: string): Promise<void> {
    if (path !== useWorkspace.getState().list?.history) {
        await updateHistory([path]);
    }
}

/** Offers to save the list's unsaved BOMs; false if the user cancelled. */
export async function confirmDiscardList(): Promise<boolean> {
    const { list } = useWorkspace.getState();
    const unsaved = unsavedPaths();
    if (!list || unsaved.length === 0) {
        return true;
    }
    const choice = await window.api.dialog.askSaveChanges(
        unsaved.length === 1
            ? fileTitle(unsaved[0]!)
            : `${unsaved.length} BOMs of ${fileTitle(list.filePath)}`
    );
    if (choice === "save") {
        return saveAllInList();
    }
    return choice === "discard";
}

export async function addBomsToList(): Promise<void> {
    const { list } = useWorkspace.getState();
    if (!list) {
        return;
    }
    const opened = await window.api.list.addBoms();
    const known = new Set([...list.boms, list.history]);
    const added = opened.filter(bom => !known.has(bom.filePath));
    if (added.length === 0) {
        if (opened.length > 0) {
            showMessage("Those BOMs are in the list already.");
        }
        return;
    }
    useWorkspace.setState(state => ({
        list: { ...list, boms: [...list.boms, ...added.map(b => b.filePath)] },
        documents: {
            ...state.documents,
            ...Object.fromEntries(
                added.map(bom => [
                    bom.filePath,
                    fresh(bom.project, bom.supplierDataInFile)
                ])
            )
        },
        message: null
    }));
    await saveListFile();
    await updateHistory(added.map(bom => bom.filePath));
    selectInList(added[0]!.filePath);
}

/** Offers to save a BOM that leaves the list; false if cancelled. */
async function confirmLeaving(path: string): Promise<boolean> {
    const document = documentOf(path);
    if (!document || !isDirty(document)) {
        return true;
    }
    const choice = await window.api.dialog.askSaveChanges(fileTitle(path));
    return choice === "save" ? saveListBom(path) : choice === "discard";
}

function forget(path: string): void {
    useWorkspace.setState(state => {
        const documents = { ...state.documents };
        const errors = { ...state.errors };
        delete documents[path];
        delete errors[path];
        return { documents, errors };
    });
}

/** Takes a BOM off the list; its file stays. */
export async function removeFromList(path: string): Promise<void> {
    const { list } = useWorkspace.getState();
    if (!list?.boms.includes(path) || !(await confirmLeaving(path))) {
        return;
    }
    const index = list.boms.indexOf(path);
    const boms = list.boms.filter(bom => bom !== path);
    if (useWorkspace.getState().selected === path) {
        selectInList(boms[Math.min(index, boms.length - 1)] ?? null);
    }
    forget(path);
    useWorkspace.setState({ list: { ...list, boms }, message: null });
    await saveListFile();
}

/** Uses another BOM as the history; it gets the parts of every BOM. */
export async function chooseHistory(): Promise<void> {
    const { list } = useWorkspace.getState();
    if (!list) {
        return;
    }
    const opened = await window.api.list.chooseHistory();
    if (!opened) {
        return;
    }
    if (list.boms.includes(opened.filePath)) {
        showMessage(
            `${fileTitle(opened.filePath)} is a BOM of the list, so it can't be its history too.`
        );
        return;
    }
    const old = list.history;
    if (old && old !== opened.filePath) {
        if (!(await confirmLeaving(old))) {
            return;
        }
        if (useWorkspace.getState().selected === old) {
            selectInList(list.boms[0] ?? null);
        }
        forget(old);
    }
    useWorkspace.setState(state => ({
        list: { ...list, history: opened.filePath },
        documents: {
            ...state.documents,
            [opened.filePath]: fresh(opened.project, opened.supplierDataInFile)
        },
        message: null
    }));
    await saveListFile();
    await updateHistory(list.boms);
}

export interface UnifyResult {
    /** Names of the changed BOMs. */
    boms: string[];
    rows: number;
    backupFolder: string;
    /** The changed BOMs that come from a KiCad project. */
    kicad: string[];
}

/**
 * Saves the BOMs Unify changed, after a backup of their files, with the
 * data collected for the chosen part numbers. Each change is an undo step
 * of its BOM. The history gets the new part numbers.
 */
export async function applyUnify(
    changes: UnifyChanges,
    collected: CollectedData
): Promise<UnifyResult> {
    const { list } = useWorkspace.getState();
    if (!list) {
        throw new Error("No BOM list is open.");
    }
    const boms = [...changes.projects].map(([filePath, project]) => ({
        filePath,
        project: withNewerResults(project, collected, usedPartNumbers(project))
    }));
    const backupFolder = await window.api.list.saveBoms(list.filePath, boms);
    for (const { filePath, project } of boms) {
        const document = documentOf(filePath);
        if (document) {
            setDocument(filePath, {
                project,
                savedProject: project,
                past: [...document.past, document.project],
                future: []
            });
        }
    }
    if (useWorkspace.getState().selected === COMBINED) {
        showCombined();
    }
    await updateHistory(boms.map(bom => bom.filePath));
    return {
        boms: boms.map(bom => fileTitle(bom.filePath)),
        rows: [...changes.rows.values()].reduce((sum, rows) => sum + rows, 0),
        backupFolder,
        kicad: boms
            .filter(bom => bom.project.source.kind === "kicad")
            .map(bom => fileTitle(bom.filePath))
    };
}
