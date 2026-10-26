import { useEffect, useMemo, useState } from "react";
import type { AppInfo } from "../shared/ipc";
import type { SupplierId } from "../shared/model";
import { BASE_CURRENCY, bomTotals, foreignCurrencies } from "../shared/pricing";
import { setCell, totalQuantity } from "../shared/project-ops";
import { SUPPLIERS } from "../shared/suppliers";
import {
    closeDialog,
    isTextEditing,
    openSettings,
    redo,
    runMenuCommand,
    undo
} from "./commands";
import { ChooseItemDialog } from "./dialogs/ChooseItemDialog";
import { ColumnsDialog } from "./dialogs/ColumnsDialog";
import { CollectDialog } from "./dialogs/CollectDialog";
import { CsvImportDialog } from "./dialogs/CsvImportDialog";
import { KicadImportDialog } from "./dialogs/KicadImportDialog";
import { SettingsDialog } from "./settings/SettingsDialog";
import { documentName, isDirty, useDocument } from "./store/document";
import { loadAppSettings, useAppSettings } from "./store/settings";
import { useUi } from "./store/ui";
import { BomTable } from "./table/BomTable";
import { Toolbar } from "./Toolbar";

const MONEY = new Intl.NumberFormat("en", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
});

function count(n: number, noun: string): string {
    return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

export function App() {
    const project = useDocument(state => state.project);
    const name = useDocument(state => documentName(state.filePath));
    const dirty = useDocument(isDirty);
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const editRowId = useUi(state => state.editRowId);
    const dialog = useUi(state => state.dialog);
    const [info, setInfo] = useState<AppInfo>();

    const totals = useMemo(
        () => bomTotals(project, preference),
        [project, preference]
    );
    const foreign = useMemo(() => foreignCurrencies(project), [project]);
    const hasData = project.suppliers.some(
        s => Object.keys(project.collected.results[s] ?? {}).length > 0
    );

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
        document.title = `${dirty ? "*" : ""}${name} - EEZ BOM checker`;
        window.api.window.setDocumentState({ name, dirty });
    }, [name, dirty]);

    return (
        <div className="app">
            <Toolbar />
            {Object.entries(foreign).map(([supplier, currencies]) => (
                <div key={supplier} className="banner" role="alert">
                    {SUPPLIERS[supplier as SupplierId].name} prices are in{" "}
                    {currencies.join(", ")}. Totals and the best price are only
                    calculated in {BASE_CURRENCY}, so these prices are left out.
                    If {SUPPLIERS[supplier as SupplierId].name} can return{" "}
                    {BASE_CURRENCY}, set it in{" "}
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
            <main className="app-table">
                <BomTable
                    project={project}
                    preference={preference}
                    editRowId={editRowId}
                    onEditStarted={() => useUi.setState({ editRowId: null })}
                    onCellEdit={(rowId, key, value) =>
                        useDocument
                            .getState()
                            .edit(p => setCell(p, rowId, key, value))
                    }
                    onSelectionChange={ids =>
                        useUi.setState({ selectedRowIds: ids })
                    }
                />
            </main>
            <footer className="status-bar">
                <span data-testid="bom-summary">
                    {count(project.rows.length, "row")} ·{" "}
                    {count(totalQuantity(project), "part")}
                </span>
                {hasData && (
                    <span data-testid="bom-total">
                        Best price total: {MONEY.format(totals.total)}{" "}
                        {BASE_CURRENCY}
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
