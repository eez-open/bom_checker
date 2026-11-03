import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { AppInfo, ColumnGroup } from "../shared/ipc";
import type { SupplierId } from "../shared/model";
import { BASE_CURRENCY, bomTotals, foreignCurrencies } from "../shared/pricing";
import {
    manualSuppliersWithPrices,
    setCell,
    suppliersWithData
} from "../shared/project-ops";
import { fileTitle } from "../shared/bom-list";
import { SUPPLIERS } from "../shared/suppliers";
import {
    closeDialog,
    isTextEditing,
    openCostChart,
    openPath,
    openSettings,
    redo,
    runMenuCommand,
    showAllColumns,
    undo
} from "./commands";
import { ChooseItemDialog } from "./dialogs/ChooseItemDialog";
import { ColumnsDialog } from "./dialogs/ColumnsDialog";
import { CollectDialog } from "./dialogs/CollectDialog";
import { CsvImportDialog } from "./dialogs/CsvImportDialog";
import { BomCostChartDialog, CostChartDialog } from "./dialogs/CostChartDialog";
import { ExportDialog } from "./dialogs/ExportDialog";
import { KicadImportDialog } from "./dialogs/KicadImportDialog";
import { KicadSyncDialog } from "./dialogs/KicadSyncDialog";
import { KicadUpdateDialog } from "./dialogs/KicadUpdateDialog";
import { UnifyDialog } from "./dialogs/UnifyDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { StartPage } from "./StartPage";
import { FilterBar, rowViews, TableTabs, tableGroups } from "./FilterBar";
import { addBomsToList, removeFromList } from "./list-commands";
import { ListPane } from "./ListPane";
import { documentName, isDirty, useDocument } from "./store/document";
import { loadAppSettings, useAppSettings, useNumbers } from "./store/settings";
import { shownTab, useUi, type TableGroup } from "./store/ui";
import { COMBINED, useWorkspace } from "./store/workspace";
import { BomTable } from "./table/BomTable";
import { Toolbar } from "./Toolbar";

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer.types.includes("Files");
}

const onShownRows = (rows: number | null) =>
    useUi.setState({ shownRows: rows });

const onEditError = (message: string | null) =>
    useUi.setState({ editError: message });

/** The right side of a list (#35) when it shows no BOM. */
function ListPlaceholder() {
    const selected = useWorkspace(state => state.selected);
    const error = useWorkspace(state =>
        state.selected ? state.errors[state.selected] : undefined
    );
    const hasBoms = useWorkspace(state => (state.list?.boms.length ?? 0) > 0);
    if (selected && error) {
        return (
            <div className="list-placeholder">
                <p className="field-error">
                    Can&apos;t read {fileTitle(selected)}: {error}
                </p>
                <p className="muted">{selected}</p>
                <button
                    type="button"
                    onClick={() => void removeFromList(selected)}
                >
                    Remove from the list
                </button>
            </div>
        );
    }
    return (
        <div className="list-placeholder">
            <p>
                {hasBoms
                    ? "Select a BOM on the left."
                    : "Add the BOMs whose part numbers should match, e.g. the modules of one device."}
            </p>
            <button
                type="button"
                className="primary"
                onClick={() => void addBomsToList()}
            >
                Add BOMs…
            </button>
        </div>
    );
}

export function App() {
    const open = useDocument(state => state.open);
    const project = useDocument(state => state.project);
    const readOnly = useDocument(state => state.readOnly);
    const name = useDocument(state => documentName(state.filePath));
    const shownDirty = useDocument(state => !state.readOnly && isDirty(state));
    const list = useWorkspace(state => state.list);
    const combined = useWorkspace(state => state.selected === COMBINED);
    // A list has unsaved changes when any of its BOMs has.
    const waitingDirty = useWorkspace(state =>
        Object.values(state.documents).some(isDirty)
    );
    const dirty = (open && shownDirty) || waitingDirty;
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const numbers = useNumbers();
    const editRowId = useUi(state => state.editRowId);
    const dialog = useUi(state => state.dialog);
    const hiddenColumns = useUi(state => state.hiddenColumns);
    const search = useUi(state => state.search);
    const shownRows = useUi(state => state.shownRows);
    const editError = useUi(state => state.editError);
    // A filter for a supplier without data any more shows all rows.
    const chosenView = useUi(state => state.rowView);
    const rowView = rowViews(project).some(([value]) => value === chosenView)
        ? chosenView
        : "all";
    const [info, setInfo] = useState<AppInfo>();
    // dragenter and dragleave also fire for every child element.
    const [dragging, setDragging] = useState(false);
    const dragDepth = useRef(0);

    const totals = useMemo(
        () => bomTotals(project, preference),
        [project, preference]
    );
    const foreign = useMemo(() => foreignCurrencies(project), [project]);
    const withData = suppliersWithData(project);
    const priced = withData.length + manualSuppliersWithPrices(project).length;
    const hasData = priced > 0;
    const groups = tableGroups(project);
    // With tabs (#41), the groups of the other tabs are hidden.
    const tableLayout = useUi(state => state.tableLayout);
    const chosenTab = useUi(state => state.tableTab);
    const tabs = tableLayout === "tabs" && groups.length > 0;
    const tab = shownTab(groups, chosenTab);
    const shownHidden: TableGroup[] = tabs
        ? groups.map(group => group.id).filter(id => id !== tab)
        : hiddenColumns;
    const hidden = tabs
        ? []
        : groups.filter(group => hiddenColumns.includes(group.id));
    // The View menu has the groups of suppliers with an API and Best price.
    const availableKey = groups
        .map(group => group.id)
        .filter(id => !id.startsWith("manual:"))
        .join(",");
    const fromKicad = project.source.kind === "kicad" && !!project.source.path;
    const hasRows = project.rows.length > 0;

    useEffect(() => {
        loadAppSettings();
        window.api.app
            .getInfo()
            .then(setInfo)
            .catch((error: unknown) =>
                console.error("Failed to get app info", error)
            );
    }, []);

    useEffect(() => window.api.onMenuCommand(runMenuCommand), []);
    useEffect(() => window.api.onOpenRecent(path => void openPath(path)), []);

    useEffect(() => {
        // Ctrl+Z / Ctrl+Y undo BOM edits; inside text fields the browser's
        // own undo applies (see Edit menu in main/menu.ts).
        const onKeyDown = (event: KeyboardEvent) => {
            if (!(event.ctrlKey || event.metaKey) || isTextEditing()) {
                return;
            }
            const key = event.key.toLowerCase();
            if (key === "z" && !event.shiftKey) {
                event.preventDefault();
                undo();
            } else if (key === "y" || (key === "z" && event.shiftKey)) {
                event.preventDefault();
                redo();
            }
        };
        document.addEventListener("keydown", onKeyDown);
        return () => document.removeEventListener("keydown", onKeyDown);
    }, []);

    useEffect(() => {
        window.api.window.setMenuState({
            documentOpen: open,
            listOpen: list !== null,
            editable: open && !readOnly,
            hasRows: open && hasRows,
            fromKicad: open && fromKicad,
            availableColumns:
                open && availableKey
                    ? (availableKey.split(",") as ColumnGroup[])
                    : [],
            hiddenColumns: shownHidden.filter(
                (group): group is ColumnGroup => !group.startsWith("manual:")
            ),
            tabs: tableLayout === "tabs"
        });
        // shownHidden follows from the others.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        open,
        list,
        readOnly,
        hasRows,
        fromKicad,
        availableKey,
        hiddenColumns,
        tableLayout,
        tab
    ]);

    const listName = list ? fileTitle(list.filePath) : null;
    useEffect(() => {
        const shown = combined ? "Combined" : open ? name : null;
        const title = listName
            ? [listName, shown].filter(Boolean).join(" · ")
            : open
              ? name
              : null;
        document.title = title
            ? `${dirty ? "*" : ""}${title} - EEZ BOM checker`
            : "EEZ BOM checker";
        window.api.window.setDocumentState({
            name: listName ?? name,
            dirty
        });
    }, [open, name, dirty, listName, combined]);

    const onDrop = (event: DragEvent) => {
        if (!hasFiles(event)) {
            return;
        }
        event.preventDefault();
        dragDepth.current = 0;
        setDragging(false);
        const file = event.dataTransfer.files[0];
        const path = file ? window.api.app.pathForFile(file) : "";
        if (path && !useUi.getState().dialog) {
            void openPath(path);
        }
    };

    return (
        <div
            className="app"
            onDragEnter={event => {
                if (hasFiles(event)) {
                    dragDepth.current++;
                    setDragging(true);
                }
            }}
            onDragLeave={event => {
                if (hasFiles(event) && --dragDepth.current <= 0) {
                    dragDepth.current = 0;
                    setDragging(false);
                }
            }}
            onDragOver={event => {
                if (hasFiles(event)) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "copy";
                }
            }}
            onDrop={onDrop}
        >
            <Toolbar />
            {!open && !list && (
                <main className="app-start">
                    <StartPage dragging={dragging} />
                </main>
            )}
            {(list || open) && (
                <div className="workspace">
                    {list && <ListPane />}
                    <div className="workspace-main">
                        {list && !open && <ListPlaceholder />}
                        {open &&
                            Object.entries(foreign).map(
                                ([supplier, currencies]) => (
                                    <div
                                        key={supplier}
                                        className="banner"
                                        role="alert"
                                    >
                                        {SUPPLIERS[supplier as SupplierId].name}{" "}
                                        prices are in {currencies.join(", ")}.
                                        Totals and the best price are only
                                        calculated in {BASE_CURRENCY}, so these
                                        prices are left out. If{" "}
                                        {SUPPLIERS[supplier as SupplierId].name}{" "}
                                        can return {BASE_CURRENCY}, set it in{" "}
                                        <button
                                            type="button"
                                            className="link"
                                            onClick={openSettings}
                                        >
                                            Settings
                                        </button>{" "}
                                        and collect again.
                                    </div>
                                )
                            )}
                        {open && (
                            <FilterBar project={project} rows={shownRows} />
                        )}
                        {open && tabs && <TableTabs project={project} />}
                        {open && (
                            <main className="app-table">
                                <BomTable
                                    project={project}
                                    preference={preference}
                                    numbers={numbers}
                                    hiddenColumns={shownHidden}
                                    editRowId={editRowId}
                                    onEditStarted={() =>
                                        useUi.setState({ editRowId: null })
                                    }
                                    onCellEdit={(rowId, key, value) =>
                                        useDocument
                                            .getState()
                                            .edit(p =>
                                                setCell(p, rowId, key, value)
                                            )
                                    }
                                    onSelectionChange={ids =>
                                        useUi.setState({ selectedRowIds: ids })
                                    }
                                    search={search}
                                    rowView={rowView}
                                    onShownRows={onShownRows}
                                    readOnly={readOnly}
                                    onEditError={onEditError}
                                />
                            </main>
                        )}
                    </div>
                </div>
            )}
            <footer className="status-bar">
                {open && editError && (
                    <span className="field-error" role="alert">
                        {editError}
                    </span>
                )}
                <span hidden={open && !!editError}>
                    {open && (
                        <span data-testid="bom-summary">
                            {count(project.rows.length, "row")}
                        </span>
                    )}
                    {open && hidden.length > 0 && (
                        <span data-testid="hidden-columns">
                            {" "}
                            · Hidden:{" "}
                            {hidden.map(group => group.name).join(", ")}{" "}
                            <button
                                type="button"
                                className="link"
                                onClick={showAllColumns}
                            >
                                Show all
                            </button>
                        </span>
                    )}
                </span>
                {open && hasData && (
                    <span>
                        <span data-testid="bom-total">
                            Best price total: {numbers.money(totals.total)}{" "}
                            {BASE_CURRENCY}
                            {project.buildQuantity > 1 &&
                                ` (${numbers.money(totals.total / project.buildQuantity)} ${BASE_CURRENCY} per unit)`}
                            {totals.uncovered > 0 &&
                                ` · ${count(totals.uncovered, "row")} without a supplier that has enough stock`}
                        </span>{" "}
                        ·{" "}
                        <button
                            type="button"
                            className="link"
                            onClick={openCostChart}
                        >
                            Most expensive parts
                        </button>
                    </span>
                )}
                <span data-testid="app-version">
                    {info ? `v${info.version}` : ""}
                </span>
            </footer>
            {dialog?.kind === "columns" && (
                <ColumnsDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "csv-import" && (
                <CsvImportDialog file={dialog.file} onClose={closeDialog} />
            )}
            {dialog?.kind === "kicad-import" && (
                <KicadImportDialog
                    project={dialog.project}
                    onClose={closeDialog}
                />
            )}
            {dialog?.kind === "export" && (
                <ExportDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "cost-chart" && (
                <CostChartDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "bom-costs" && (
                <BomCostChartDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "unify" && <UnifyDialog onClose={closeDialog} />}
            {dialog?.kind === "kicad-update" && (
                <KicadUpdateDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "kicad-sync" && (
                <KicadSyncDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "collect" && (
                <CollectDialog onClose={closeDialog} />
            )}
            {dialog?.kind === "choose-item" && (
                <ChooseItemDialog
                    supplier={dialog.supplier}
                    partNumberKey={dialog.key}
                    onClose={closeDialog}
                />
            )}
            {dialog?.kind === "settings" && (
                <SettingsDialog onClose={closeDialog} />
            )}
        </div>
    );
}
