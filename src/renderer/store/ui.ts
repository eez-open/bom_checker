import { create } from "zustand";
import type { OpenedFile } from "../../shared/ipc";

export type OpenDialog =
    | { kind: "columns" }
    | { kind: "csv-import"; file: OpenedFile }
    | { kind: "settings" }
    | null;

/** UI state that isn't part of the BOM (not saved, not undoable). */
interface UiStore {
    selectedRowIds: string[];
    /** A newly added row whose Reference cell should start editing. */
    editRowId: string | null;
    dialog: OpenDialog;
}

export const useUi = create<UiStore>()(() => ({
    selectedRowIds: [],
    editRowId: null,
    dialog: null
}));
