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
    | { kind: "kicad-update" }
    | { kind: "kicad-sync" }
    | { kind: "choose-item"; supplier: SupplierId; key: string }
    | null;

/** A column group that can be hidden: a supplier with an API, one without
 *  ("manual:<id>") or Best price. Only the first and the last are in the
 *  View menu. */
export type TableGroup = ColumnGroup | `manual:${string}`;

/** UI state that isn't part of the BOM (not saved, not undoable). */
interface UiStore {
    selectedRowIds: string[];
    /** A newly added row whose Reference cell should start editing. */
    editRowId: string | null;
    dialog: OpenDialog;
    /** Column groups hidden from the table; remembered between sessions. */
    hiddenColumns: TableGroup[];
    /** Text the table's rows are searched for (Ctrl+F). */
    search: string;
    /** Rows filter: "all", "best:<supplier>" or "none" (no supplier can
     *  deliver). */
    rowView: string;
    /** Rows shown with the filters on; null when nothing is filtered. */
    shownRows: number | null;
}

const HIDDEN_COLUMNS_KEY = "hidden-columns";

function loadHiddenColumns(): TableGroup[] {
    try {
        const saved = JSON.parse(
            localStorage.getItem(HIDDEN_COLUMNS_KEY) ?? "[]"
        ) as unknown;
        return Array.isArray(saved)
            ? [
                  ...COLUMN_GROUPS.filter(group => saved.includes(group)),
                  ...saved.filter(
                      (group): group is `manual:${string}` =>
                          typeof group === "string" &&
                          group.startsWith("manual:")
                  )
              ]
            : [];
    } catch {
        return [];
    }
}

export const useUi = create<UiStore>()(() => ({
    selectedRowIds: [],
    editRowId: null,
    dialog: null,
    hiddenColumns: loadHiddenColumns(),
    search: "",
    rowView: "all",
    shownRows: null
}));

export function setHiddenColumns(hidden: TableGroup[]): void {
    useUi.setState({ hiddenColumns: hidden });
    try {
        localStorage.setItem(HIDDEN_COLUMNS_KEY, JSON.stringify(hidden));
    } catch {
        // Only a convenience.
    }
}
