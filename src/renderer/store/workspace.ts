import { create } from "zustand";
import type { ListState } from "../../shared/ipc";
import type { DocumentSnapshot } from "./document";

/** Selection of the list's Combined BOM (#35), instead of a BOM's path. */
export const COMBINED = "combined";

export type OpenList = ListState;

/** What the list file holds, which Undo and Save of the list apply to
 *  (#77): its BOMs, their quantities, the history and the description. */
export type ListContent = Omit<ListState, "filePath">;

/** A BOM list (#35): the BOMs on the left, the selected one on the right. */
interface WorkspaceStore {
    /** Null when a single BOM, or nothing, is open. */
    list: OpenList | null;
    /** The list as last opened or saved; it has unsaved changes when
     *  `list` differs from it (#77). */
    savedList: ListContent | null;
    /** Earlier versions of the list, for Undo, and undone ones, for Redo
     *  (#77). */
    listPast: ListContent[];
    listFuture: ListContent[];
    /** The list's BOMs (and history) that aren't shown, with their unsaved
     *  changes and undo history, by path. The shown one is in useDocument.
     *  BOMs taken off the list stay here, so Undo can bring them back. */
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
    savedList: null,
    listPast: [],
    listFuture: [],
    documents: {},
    errors: {},
    selected: null,
    message: null
}));
