import { create } from "zustand";
import type { ListState } from "../../shared/ipc";
import type { DocumentSnapshot } from "./document";

/** Selection of the list's Combined BOM (#35), instead of a BOM's path. */
export const COMBINED = "combined";

export type OpenList = ListState;

/** A BOM list (#35): the BOMs on the left, the selected one on the right. */
interface WorkspaceStore {
    /** Null when a single BOM, or nothing, is open. */
    list: OpenList | null;
    /** The list's BOMs (and history) that aren't shown, with their unsaved
     *  changes and undo history, by path. The shown one is in useDocument. */
    documents: Record<string, DocumentSnapshot>;
    /** Why BOMs couldn't be read, by path. */
    errors: Record<string, string>;
    /** What's shown: a BOM's path, COMBINED, or null for nothing. */
    selected: string | null;
    /** A problem with the list itself, e.g. it couldn't be saved. */
    message: string | null;
}

export const useWorkspace = create<WorkspaceStore>()(() => ({
    list: null,
    documents: {},
    errors: {},
    selected: null,
    message: null
}));
