import { create } from "zustand";
import type { KicadProjectData, OpenedFile } from "../../shared/ipc";
import type { SupplierId } from "../../shared/model";

export type OpenDialog =
    | { kind: "columns" }
    | { kind: "csv-import"; file: OpenedFile }
    | { kind: "kicad-import"; project: KicadProjectData }
    | { kind: "settings" }
    | { kind: "collect" }
    | { kind: "choose-item"; supplier: SupplierId; key: string }
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
