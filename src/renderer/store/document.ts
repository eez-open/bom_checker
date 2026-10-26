import { create } from "zustand";
import type { Project } from "../../shared/model";
import { PROJECT_FILE_EXTENSION } from "../../shared/project-file";
import { createProject } from "../../shared/project-ops";

const HISTORY_LIMIT = 100;

interface DocumentStore {
    project: Project;
    /** The project as last opened or saved; null if it never was. Unsaved
     *  changes exist when `project !== savedProject`. */
    savedProject: Project | null;
    filePath: string | null;
    past: Project[];
    future: Project[];

    /** Applies an edit. Edits that return the same object aren't recorded. */
    edit: (change: (project: Project) => Project) => void;
    undo: () => void;
    redo: () => void;
    /** Replaces the open BOM (New, Open, Import) and clears the history. */
    load: (
        project: Project,
        options: { filePath: string | null; saved: boolean }
    ) => void;
    markSaved: (project: Project, filePath: string) => void;
}

export const useDocument = create<DocumentStore>()((set, get) => {
    const initial = createProject();
    return {
        project: initial,
        savedProject: initial,
        filePath: null,
        past: [],
        future: [],

        edit: change => {
            const { project, past } = get();
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
                    project: previous,
                    past: past.slice(0, -1),
                    future: [project, ...future]
                });
            }
        },
        redo: () => {
            const { project, past, future } = get();
            const [next, ...rest] = future;
            if (next) {
                set({ project: next, past: [...past, project], future: rest });
            }
        },
        load: (project, { filePath, saved }) =>
            set({
                project,
                savedProject: saved ? project : null,
                filePath,
                past: [],
                future: []
            }),
        markSaved: (project, filePath) =>
            set({ savedProject: project, filePath })
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
    if (!filePath) {
        return "Untitled";
    }
    const name = filePath.split(/[\\/]/).pop() ?? filePath;
    const extension = `.${PROJECT_FILE_EXTENSION}`;
    return name.toLowerCase().endsWith(extension)
        ? name.slice(0, -extension.length)
        : name;
}
