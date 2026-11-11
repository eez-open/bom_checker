// BOM lists (#35): the list on the left and its BOMs. The selected BOM is
// in useDocument like a single open BOM, so everything else works on it
// unchanged; the others wait in useWorkspace with their unsaved changes
// and undo history. The list itself has unsaved changes and undo too, and
// is written by Save, like a BOM (#77).

import {
    fileTitle,
    usedPartNumbers,
    withNewerResults,
    type ListMember
} from "../shared/bom-list";
import { withoutResults, type ResultKeys } from "../shared/collection";
import { combineBoms } from "../shared/combined-bom";
import type { ListState, OpenedList } from "../shared/ipc";
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
import {
    COMBINED,
    useWorkspace,
    type ListContent,
    type OpenList
} from "./store/workspace";

/** Undo steps of a list kept (#77), as for a BOM. */
const LIST_HISTORY_LIMIT = 100;

// Typing in the description is one undo step until the field is left.
let editingDescription = false;

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

function contentOf(list: ListState): ListContent {
    const { boms, perDevice, history, buildQuantity, description } = list;
    return { boms, perDevice, history, buildQuantity, description };
}

/** The same BOMs, in the same order, the same number of each per device. */
function sameBoms(a: ListContent, b: ListContent): boolean {
    return (
        a.boms.length === b.boms.length &&
        a.boms.every(
            (path, index) =>
                path === b.boms[index] &&
                (a.perDevice[path] ?? 1) === (b.perDevice[path] ?? 1)
        )
    );
}

/** What the list file would hold is the same. */
function sameContent(a: ListContent, b: ListContent): boolean {
    return (
        sameBoms(a, b) &&
        a.history === b.history &&
        a.buildQuantity === b.buildQuantity &&
        a.description === b.description
    );
}

/** The Combined BOM of `after` differs from that of `before`. */
function combinedChanged(before: ListContent, after: ListContent): boolean {
    return (
        !sameBoms(before, after) || before.buildQuantity !== after.buildQuantity
    );
}

/** The BOMs of the list and its history. */
function membersOf(content: ListContent): string[] {
    return [...content.boms, ...(content.history ? [content.history] : [])];
}

/** The list has changes that its file doesn't have yet (#77). */
export function isListDirty(
    state: {
        list: ListState | null;
        savedList: ListContent | null;
    } = useWorkspace.getState()
): boolean {
    return (
        state.list !== null &&
        (state.savedList === null ||
            !sameContent(contentOf(state.list), state.savedList))
    );
}

export function isListOpen(): boolean {
    return useWorkspace.getState().list !== null;
}

/** The list shows its Combined BOM, or no BOM: Save, Save As, Undo and
 *  Redo are the list's then (#77). */
export function isListShown(): boolean {
    const { list, selected } = useWorkspace.getState();
    return (
        list !== null && (selected === COMBINED || !useDocument.getState().open)
    );
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
    return list ? membersOf(list).filter(path => !errors[path]) : [];
}

/** The list's BOMs that could be read, as they are now (not the history). */
export function listMembers(): ListMember[] {
    const { list, errors } = useWorkspace.getState();
    return (list?.boms ?? []).flatMap(path => {
        const document = errors[path] ? undefined : documentOf(path);
        return document
            ? [
                  {
                      path,
                      name: fileTitle(path),
                      project: document.project,
                      perDevice: list?.perDevice[path] ?? 1
                  }
              ]
            : [];
    });
}

/** The BOM of the list that's shown, as it is now; null for Combined or
 *  nothing. */
export function shownMember(): ListMember | null {
    const { list, selected } = useWorkspace.getState();
    const { open, project } = useDocument.getState();
    if (!list || !selected || selected === COMBINED || !open) {
        return null;
    }
    return {
        path: selected,
        name: fileTitle(selected),
        project,
        perDevice: list.perDevice[selected] ?? 1
    };
}

/** The list's BOMs (and history) with unsaved changes. */
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
    const list: OpenList = {
        filePath: opened.filePath,
        boms: opened.boms.map(bom => bom.path),
        perDevice: opened.perDevice,
        history: opened.history?.path ?? null,
        buildQuantity: opened.buildQuantity,
        description: opened.description
    };
    editingDescription = false;
    useWorkspace.setState({
        list,
        savedList: contentOf(list),
        listPast: [],
        listFuture: [],
        documents,
        errors,
        selected: null,
        message: null
    });
    selectInList(opened.boms[0]?.path ?? null);
}

export function closeList(): void {
    editingDescription = false;
    useWorkspace.setState({
        list: null,
        savedList: null,
        listPast: [],
        listFuture: [],
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
    resetTableView({ keepSearch: true });

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
    const buildQuantity = useWorkspace.getState().list?.buildQuantity ?? 1;
    useDocument.getState().load(combineBoms(listMembers(), buildQuantity), {
        filePath: null,
        saved: true,
        readOnly: true
    });
}

/**
 * Changes the list: one undo step, or part of the last one with `merge`.
 * The list file is written by Save (#77).
 */
function changeList(change: (list: OpenList) => OpenList, merge = false): void {
    const { list, listPast, selected } = useWorkspace.getState();
    if (!list) {
        return;
    }
    const next = change(list);
    if (next === list) {
        return;
    }
    useWorkspace.setState({
        list: next,
        listPast: merge
            ? listPast
            : [...listPast.slice(1 - LIST_HISTORY_LIMIT), contentOf(list)],
        listFuture: [],
        message: null
    });
    if (selected === COMBINED && combinedChanged(list, next)) {
        showCombined();
    }
}

/** Changes how many of a BOM one device has, or how many devices the
 *  Combined BOM is for (#39). */
export function setListQuantities(change: {
    perDevice?: [path: string, count: number];
    buildQuantity?: number;
}): void {
    editingDescription = false;
    changeList(list => {
        const perDevice = { ...list.perDevice };
        if (change.perDevice) {
            const [path, count] = change.perDevice;
            perDevice[path] = count;
        }
        const next = {
            ...list,
            perDevice,
            buildQuantity: change.buildQuantity ?? list.buildQuantity
        };
        return sameContent(contentOf(list), contentOf(next)) ? list : next;
    });
}

/** Changes the list's description as it's typed (#72). */
export function editListDescription(description: string): void {
    changeList(
        list =>
            list.description === description ? list : { ...list, description },
        editingDescription
    );
    editingDescription = true;
}

/** The description field was left: typing there again is another undo
 *  step. */
export function endDescriptionEdit(): void {
    editingDescription = false;
}

/** Undoes the last change of the list (#77). */
export function undoList(): Promise<void> {
    return stepList("undo");
}

/** Redoes the last change of the list that was undone (#77). */
export function redoList(): Promise<void> {
    return stepList("redo");
}

/**
 * Goes back to the list before its last change, or forward again. A BOM
 * that leaves the list with it is offered to be saved first, as when it's
 * removed; one that comes back has what it had when it left.
 */
async function stepList(direction: "undo" | "redo"): Promise<void> {
    const { list, listPast, listFuture } = useWorkspace.getState();
    const target = direction === "undo" ? listPast.at(-1) : listFuture[0];
    if (!list || !target) {
        return;
    }
    const staying = new Set(membersOf(target));
    for (const path of membersOf(list)) {
        if (!staying.has(path) && !(await confirmLeaving(path))) {
            return;
        }
    }
    // The list may have changed while asking.
    if (useWorkspace.getState().list !== list) {
        return;
    }
    const { selected } = useWorkspace.getState();
    if (selected && selected !== COMBINED && !staying.has(selected)) {
        selectInList(target.boms[0] ?? null);
    }
    editingDescription = false;
    const current = contentOf(list);
    useWorkspace.setState(state => {
        // BOMs taken off the list are kept; in case one isn't any more.
        const missing = membersOf(target).filter(
            path =>
                !state.documents[path] &&
                !state.errors[path] &&
                path !== state.selected
        );
        return {
            list: { ...target, filePath: list.filePath },
            listPast:
                direction === "undo"
                    ? state.listPast.slice(0, -1)
                    : [...state.listPast, current],
            listFuture:
                direction === "undo"
                    ? [current, ...state.listFuture]
                    : state.listFuture.slice(1),
            errors: {
                ...state.errors,
                ...Object.fromEntries(
                    missing.map(path => [
                        path,
                        "The BOM isn't open any more. Open the list again to read it."
                    ])
                )
            },
            message: null
        };
    });
    if (
        useWorkspace.getState().selected === COMBINED &&
        combinedChanged(current, target)
    ) {
        showCombined();
    }
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

// One save of the list at a time, so an older one can't finish last.
let listSaving: Promise<boolean> = Promise.resolve(true);

/** Writes the list file as the list is when its turn comes; false if that
 *  failed (the list pane says why). */
function saveListFile(): Promise<boolean> {
    listSaving = listSaving.then(async () => {
        const { list } = useWorkspace.getState();
        if (!list) {
            return true;
        }
        try {
            await window.api.list.save(list);
        } catch (error) {
            showMessage(`The list couldn't be saved: ${errorMessage(error)}`);
            return false;
        }
        if (useWorkspace.getState().list?.filePath === list.filePath) {
            useWorkspace.setState({ savedList: contentOf(list) });
        }
        return true;
    });
    return listSaving;
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

/** Saves every BOM of the list with unsaved changes, then the list itself
 *  (#77); false if one failed. */
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
    return isListDirty() ? saveListFile() : true;
}

/**
 * File → Save List As… (#77): the list under another name, naming the same
 * BOM files, which is the list from then on. Its BOMs with unsaved changes
 * are saved too, as by Save.
 */
export async function saveListAs(): Promise<boolean> {
    const { list } = useWorkspace.getState();
    if (!list) {
        return false;
    }
    let filePath: string | null;
    try {
        filePath = await window.api.list.saveAs(list);
    } catch (error) {
        showMessage(`The list couldn't be saved: ${errorMessage(error)}`);
        return false;
    }
    if (!filePath) {
        return false;
    }
    useWorkspace.setState(state => ({
        list: state.list && { ...state.list, filePath },
        savedList: contentOf(list),
        message: null
    }));
    return saveAllInList();
}

/** After the shown BOM was saved with File → Save. */
export async function afterListSave(path: string): Promise<void> {
    if (path !== useWorkspace.getState().list?.history) {
        await updateHistory([path]);
    }
}

/** Offers to save the list and its BOMs with unsaved changes; false if the
 *  user cancelled. */
export async function confirmDiscardList(): Promise<boolean> {
    endDescriptionEdit();
    const { list } = useWorkspace.getState();
    const unsaved = unsavedPaths();
    const listDirty = isListDirty();
    if (!list || (!listDirty && unsaved.length === 0)) {
        return true;
    }
    const name = fileTitle(list.filePath);
    const boms =
        unsaved.length === 1
            ? fileTitle(unsaved[0]!)
            : `${unsaved.length} BOMs`;
    const choice = await window.api.dialog.askSaveChanges(
        !listDirty
            ? unsaved.length === 1
                ? boms
                : `${boms} of ${name}`
            : unsaved.length === 0
              ? name
              : `${name} and ${unsaved.length === 1 ? boms : `${boms} of it`}`
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
    const current = useWorkspace.getState().list;
    if (!current) {
        return;
    }
    const known = new Set(membersOf(current));
    const added = opened.filter(bom => !known.has(bom.filePath));
    if (added.length === 0) {
        if (opened.length > 0) {
            showMessage("Those BOMs are in the list already.");
        }
        return;
    }
    useWorkspace.setState(state => ({
        documents: {
            ...state.documents,
            ...Object.fromEntries(
                added.map(bom => [
                    bom.filePath,
                    fresh(bom.project, bom.supplierDataInFile)
                ])
            )
        },
        errors: Object.fromEntries(
            Object.entries(state.errors).filter(
                ([path]) => !added.some(bom => bom.filePath === path)
            )
        )
    }));
    editingDescription = false;
    changeList(list => ({
        ...list,
        boms: [...list.boms, ...added.map(bom => bom.filePath)]
    }));
    await updateHistory(added.map(bom => bom.filePath));
    selectInList(added[0]!.filePath);
}

/**
 * Offers to save a BOM that leaves the list; false if cancelled. Changes
 * that aren't saved are dropped, so Undo brings back the saved BOM.
 */
async function confirmLeaving(path: string): Promise<boolean> {
    const document = documentOf(path);
    if (!document || !isDirty(document)) {
        return true;
    }
    const choice = await window.api.dialog.askSaveChanges(fileTitle(path));
    if (choice === "save") {
        return saveListBom(path);
    }
    if (choice === "discard" && document.savedProject) {
        setDocument(path, fresh(document.savedProject));
    }
    return choice === "discard";
}

/** Takes a BOM off the list; its file stays. */
export async function removeFromList(path: string): Promise<void> {
    const { list } = useWorkspace.getState();
    if (!list?.boms.includes(path) || !(await confirmLeaving(path))) {
        return;
    }
    const current = useWorkspace.getState().list;
    if (!current?.boms.includes(path)) {
        return;
    }
    const index = current.boms.indexOf(path);
    const boms = current.boms.filter(bom => bom !== path);
    if (useWorkspace.getState().selected === path) {
        selectInList(boms[Math.min(index, boms.length - 1)] ?? null);
    }
    editingDescription = false;
    changeList(list => {
        const perDevice = { ...list.perDevice };
        delete perDevice[path];
        return {
            ...list,
            boms: list.boms.filter(bom => bom !== path),
            perDevice
        };
    });
}

/** Uses another BOM as the history; it gets the parts of every BOM. */
export async function chooseHistory(): Promise<void> {
    const { list } = useWorkspace.getState();
    if (!list) {
        return;
    }
    const opened = await window.api.list.chooseHistory();
    if (!opened || opened.filePath === list.history) {
        return;
    }
    if (list.boms.includes(opened.filePath)) {
        showMessage(
            `${fileTitle(opened.filePath)} is a BOM of the list, so it can't be its history too.`
        );
        return;
    }
    const old = list.history;
    if (old) {
        if (!(await confirmLeaving(old))) {
            return;
        }
        if (useWorkspace.getState().selected === old) {
            selectInList(list.boms[0] ?? null);
        }
    }
    useWorkspace.setState(state => ({
        documents: {
            ...state.documents,
            [opened.filePath]: fresh(opened.project, opened.supplierDataInFile)
        }
    }));
    editingDescription = false;
    changeList(current => ({ ...current, history: opened.filePath }));
    await updateHistory(useWorkspace.getState().list?.boms ?? []);
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
