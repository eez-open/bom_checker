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
    | { kind: "cost-chart" }
    | { kind: "bom-costs" }
    | { kind: "unify" }
    | { kind: "check-history"; rowIds: readonly string[] | null }
    | { kind: "kicad-update" }
    | { kind: "kicad-sync" }
    | { kind: "choose-item"; supplier: SupplierId; key: string }
    | null;

/** A column group that can be hidden: a supplier with an API, one without
 *  ("manual:<id>") or Best price. Only the first and the last are in the
 *  View menu. */
export type TableGroup = ColumnGroup | `manual:${string}`;

/** The table shows every column group side by side, or each on a tab of
 *  its own (#41). */
export type TableLayout = "columns" | "tabs";

/** UI state that isn't part of the BOM (not saved, not undoable). */
interface UiStore {
    selectedRowIds: string[];
    /** A newly added row whose Reference cell should start editing. */
    editRowId: string | null;
    dialog: OpenDialog;
    /** Column groups hidden from the table; remembered between sessions. */
    hiddenColumns: TableGroup[];
    /** Remembered between sessions, like the tab. */
    tableLayout: TableLayout;
    /** The tab shown with the "tabs" layout; the first one if the BOM
     *  hasn't this group. */
    tableTab: TableGroup | null;
    /** Text the table's rows are searched for (Ctrl+F). */
    search: string;
    /** Rows filter: "all", "best:<supplier>" or "none" (no supplier can
     *  deliver). */
    rowView: string;
    /** Rows shown with the filters on; null when nothing is filtered. */
    shownRows: number | null;
    /** Why the value being edited in the table can't be entered (#58). */
    editError: string | null;
}

const HIDDEN_COLUMNS_KEY = "hidden-columns";
const LAYOUT_KEY = "table-layout";
const TAB_KEY = "table-tab";

function loadText(key: string): string | null {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
}

function saveText(key: string, value: string): void {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Only a convenience.
    }
}

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
    tableLayout: loadText(LAYOUT_KEY) === "tabs" ? "tabs" : "columns",
    tableTab: loadText(TAB_KEY) as TableGroup | null,
    search: "",
    rowView: "all",
    shownRows: null,
    editError: null
}));

/** Another BOM starts unfiltered and with no rows selected. Another BOM
 *  of the same list keeps the search text, to find it there too (#60). */
export function resetTableView({ keepSearch = false } = {}): void {
    useUi.setState(state => ({
        search: keepSearch ? state.search : "",
        rowView: "all",
        selectedRowIds: [],
        shownRows: null
    }));
}

export function setHiddenColumns(hidden: TableGroup[]): void {
    useUi.setState({ hiddenColumns: hidden });
    saveText(HIDDEN_COLUMNS_KEY, JSON.stringify(hidden));
}

export function setTableLayout(layout: TableLayout): void {
    useUi.setState({ tableLayout: layout });
    saveText(LAYOUT_KEY, layout);
}

export function setTableTab(tab: TableGroup): void {
    useUi.setState({ tableTab: tab });
    saveText(TAB_KEY, tab);
}

/** The tab to show among `groups`: the chosen one, or else the first. */
export function shownTab(
    groups: readonly { id: TableGroup }[],
    chosen: TableGroup | null
): TableGroup | null {
    return (
        groups.find(group => group.id === chosen)?.id ?? groups[0]?.id ?? null
    );
}
