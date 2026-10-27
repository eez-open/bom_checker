import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { AppInfo, ColumnGroup } from "../shared/ipc";
import type { SupplierId } from "../shared/model";
import { BASE_CURRENCY, bomTotals, foreignCurrencies } from "../shared/pricing";
import {
    setCell,
    suppliersWithData,
    totalQuantity
} from "../shared/project-ops";
import { SUPPLIERS } from "../shared/suppliers";
import {
    closeDialog,
    isTextEditing,
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
import { ExportDialog } from "./dialogs/ExportDialog";
import { KicadImportDialog } from "./dialogs/KicadImportDialog";
import { KicadSyncDialog } from "./dialogs/KicadSyncDialog";
import { KicadUpdateDialog } from "./dialogs/KicadUpdateDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { StartPage } from "./StartPage";
import { FilterBar, rowViews } from "./FilterBar";
import { documentName, isDirty, useDocument } from "./store/document";
import { loadAppSettings, useAppSettings } from "./store/settings";
import { useUi } from "./store/ui";
import { BomTable } from "./table/BomTable";
import { Toolbar } from "./Toolbar";

const MONEY = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

const AMOUNT = new Intl.NumberFormat("en", { maximumFractionDigits: 6 });

function count(n: number, noun: string): string {
    return `${AMOUNT.format(n)} ${noun}${n === 1 ? "" : "s"}`;
}

function hasFiles(event: DragEvent): boolean {
    return event.dataTransfer.types.includes("Files");
}

const onShownRows = (rows: number | null) =>
    useUi.setState({ shownRows: rows });

export function App() {
    const open = useDocument(state => state.open);
    const project = useDocument(state => state.project);
    const name = useDocument(state => documentName(state.filePath));
    const dirty = useDocument(isDirty);
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const editRowId = useUi(state => state.editRowId);
    const dialog = useUi(state => state.dialog);
    const hiddenColumns = useUi(state => state.hiddenColumns);
    const search = useUi(state => state.search);
    const shownRows = useUi(state => state.shownRows);
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
    const hasData = withData.length > 0;
    // The table shows Best price once two suppliers have data.
    const available: ColumnGroup[] = [
        ...project.suppliers,
        ...(withData.length >= 2 ? (["best"] as const) : [])
    ];
    const hidden = hiddenColumns.filter(group => available.includes(group));
    const availableKey = available.join(",");
    const fromKicad = project.source.kind === "kicad" && !!project.source.path;

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
            fromKicad: open && fromKicad,
            availableColumns:
                open && availableKey
                    ? (availableKey.split(",") as ColumnGroup[])
                    : [],
            hiddenColumns
        });
    }, [open, fromKicad, availableKey, hiddenColumns]);

    useEffect(() => {
        document.title = open
            ? `${dirty ? "*" : ""}${name} - EEZ BOM checker`
            : "EEZ BOM checker";
        window.api.window.setDocumentState({ name, dirty: open && dirty });
    }, [open, name, dirty]);

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
            {!open && (
                <main className="app-start">
                    <StartPage dragging={dragging} />
                </main>
            )}
            {open &&
                Object.entries(foreign).map(([supplier, currencies]) => (
                    <div key={supplier} className="banner" role="alert">
                        {SUPPLIERS[supplier as SupplierId].name} prices are in{" "}
                        {currencies.join(", ")}. Totals and the best price are
                        only calculated in {BASE_CURRENCY}, so these prices are
                        left out. If {SUPPLIERS[supplier as SupplierId].name}{" "}
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
                ))}
            {open && <FilterBar project={project} rows={shownRows} />}
            {open && (
                <main className="app-table">
                    <BomTable
                        project={project}
                        preference={preference}
                        hiddenColumns={hiddenColumns}
                        editRowId={editRowId}
                        onEditStarted={() =>
                            useUi.setState({ editRowId: null })
                        }
                        onCellEdit={(rowId, key, value) =>
                            useDocument
                                .getState()
                                .edit(p => setCell(p, rowId, key, value))
                        }
                        onSelectionChange={ids =>
                            useUi.setState({ selectedRowIds: ids })
                        }
                        search={search}
                        rowView={rowView}
                        onShownRows={onShownRows}
                    />
                </main>
            )}
            <footer className="status-bar">
                <span>
                    {open && (
                        <span data-testid="bom-summary">
                            {count(project.rows.length, "row")} ·{" "}
                            {count(totalQuantity(project), "part")}
                            {project.buildQuantity > 1 &&
                                ` per unit × ${project.buildQuantity} = ${count(totalQuantity(project) * project.buildQuantity, "part")}`}
                        </span>
                    )}
                    {open && hidden.length > 0 && (
                        <span data-testid="hidden-columns">
                            {" "}
                            · Hidden:{" "}
                            {hidden
                                .map(group =>
                                    group === "best"
                                        ? "Best price"
                                        : SUPPLIERS[group].name
                                )
                                .join(", ")}{" "}
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
                    <span data-testid="bom-total">
                        Best price total: {MONEY.format(totals.total)}{" "}
                        {BASE_CURRENCY}
                        {project.buildQuantity > 1 &&
                            ` (${MONEY.format(totals.total / project.buildQuantity)} ${BASE_CURRENCY} per unit)`}
                        {totals.uncovered > 0 &&
                            ` · ${count(totals.uncovered, "row")} without a supplier that has enough stock`}
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
