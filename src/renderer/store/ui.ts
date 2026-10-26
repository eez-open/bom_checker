import { create } from "zustand";
import {
    COLUMN_GROUPS,
    type ColumnGroup,
    type KicadProjectData,
    type OpenedFile
} from "../../shared/ipc";
import type { SupplierId } from "../../shared/model";

export type OpenDialog =
    | { kind: "columns" }
    | { kind: "csv-import"; file: OpenedFile }
    | { kind: "kicad-import"; project: KicadProjectData }
    | { kind: "settings" }
    | { kind: "collect" }
    | { kind: "export" }
    | { kind: "choose-item"; supplier: SupplierId; key: string }
    | null;

/** UI state that isn't part of the BOM (not saved, not undoable). */
interface UiStore {
    selectedRowIds: string[];
    /** A newly added row whose Reference cell should start editing. */
    editRowId: string | null;
    dialog: OpenDialog;
    /** Column groups hidden from the table; remembered between sessions. */
    hiddenColumns: ColumnGroup[];
}

const HIDDEN_COLUMNS_KEY = "hidden-columns";

function loadHiddenColumns(): ColumnGroup[] {
    try {
        const saved = JSON.parse(
            localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? "[]"
        ) as unknown;
        return Array.isArray(saved)
            ? COLUMN_GROUPS.filter(group => saved.includes(group))
            : [];
    } catch {
        return [];
    }
}

export const useUi = create<UiStore>()(() => ({
    selectedRowIds: [],
    editRowId: null,
    dialog: null,
    hiddenColumns: loadHiddenColumns()
}));

export function setHiddenColumns(hidden: ColumnGroup[]): void {
    useUi.setState({ hiddenColumns: hidden });
    try {
        localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(hidden));
    } catch {
        // Only a convenience.
    }
}
