import { create } from "zustand";
import type { CollectedData, Project } from "../../shared/model";
import { fileTitle } from "../../shared/bom-list";
import { createProject } from "../../shared/project-ops";

const HISTORY_LIMIT = 100;

/** A BOM with its undo history: the open one, or one of a list's BOMs
 *  that isn't shown (#35). */
export interface DocumentSnapshot {
    project: Project;
    /** The project as last opened or saved; null if it never was. Unsaved
     *  changes exist when `project !== savedProject`. */
    savedProject: Project | null;
    past: Project[];
    future: Project[];
}

interface DocumentStore extends DocumentSnapshot {
    /** False on the start page, before a BOM is created, opened or
     *  imported, and after File → Close. */
    open: boolean;
    filePath: string | null;
    /** A view that can't be edited, such as a list's Combined BOM; edits
     *  are ignored. Collecting still updates its data. */
    readOnly: boolean;

    /** Applies an edit. Edits that return the same object aren't recorded. */
    edit: (change: (project: Project) => Project) => void;
    undo: () => void;
    redo: () => void;
    /** Replaces the open BOM (New, Open, Import) and clears the history. */
    load: (
        project: Project,
        options: { filePath: string | null; saved: boolean; readOnly?: boolean }
    ) => void;
    /** Shows a BOM with its undo history, e.g. another BOM of a list. */
    restore: (snapshot: DocumentSnapshot, filePath: string) => void;
    markSaved: (project: Project, filePath: string) => void;
    /** Closes the BOM, back to the start page. */
    close: () => void;
    /** Updates collected supplier data. Not an undo step: undo and redo
     *  keep the latest collected data. */
    applyCollected: (
        change: (collected: CollectedData) => CollectedData
    ) => void;
}

/** `snapshot` with the current collected data. Keeps the same object when
 *  it already has it, so returning to the saved version isn't "unsaved". */
function withCollected(snapshot: Project, current: Project): Project {
    return snapshot.collected === current.collected
        ? snapshot
        : { ...snapshot, collected: current.collected };
}

function closed() {
    const empty = createProject();
    return {
        open: false,
        project: empty,
        savedProject: empty,
        filePath: null,
        readOnly: false,
        past: [],
        future: []
    };
}

export const useDocument = create<DocumentStore>()((set, get) => {
    return {
        ...closed(),

        edit: change => {
            const { project, past, readOnly } = get();
            if (readOnly) {
                return;
            }
            const next = change(project);
            if (next !== project) {
                set({
                    project: next,
                    past: [...past.slice(1 - HISTORY_LIMIT), project],
                    future: []
                });
            }
        },
        undo: () => {
            const { project, past, future } = get();
            const previous = past.at(-1);
            if (previous) {
                set({
                    project: withCollected(previous, project),
                    past: past.slice(0, -1),
                    future: [project, ...future]
                });
            }
        },
        redo: () => {
            const { project, past, future } = get();
            const [next, ...rest] = future;
            if (next) {
                set({
                    project: withCollected(next, project),
                    past: [...past, project],
                    future: rest
                });
            }
        },
        applyCollected: change => {
            const { project } = get();
            set({
                project: { ...project, collected: change(project.collected) }
            });
        },
        load: (project, { filePath, saved, readOnly = false }) =>
            set({
                open: true,
                project,
                savedProject: saved ? project : null,
                filePath,
                readOnly,
                past: [],
                future: []
            }),
        restore: (snapshot, filePath) =>
            set({ ...snapshot, open: true, filePath, readOnly: false }),
        markSaved: (project, filePath) =>
            set({ savedProject: project, filePath }),
        close: () => set(closed())
    };
});

export function isDirty(state: {
    project: Project;
    savedProject: Project | null;
}): boolean {
    return state.project !== state.savedProject;
}

/** File name without folder and extension, or "Untitled". */
export function documentName(filePath: string | null): string {
    return filePath ? fileTitle(filePath) : "Untitled";
}

export function snapshotOf(state: DocumentSnapshot): DocumentSnapshot {
    const { project, savedProject, past, future } = state;
    return { project, savedProject, past, future };
}
