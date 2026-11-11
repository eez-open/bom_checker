import { isAbsolute } from "node:path";
import { BrowserWindow } from "electron";
import { z } from "zod";
import { IpcChannel } from "../../shared/ipc";
import {
    MAX_LIST_DESCRIPTION,
    MAX_PER_DEVICE
} from "../../shared/bom-list-file";
import { MAX_BUILD_QUANTITY, SUPPLIER_IDS } from "../../shared/model";
import { validateProject } from "../../shared/project-file";
import { openCsvFile } from "../project/csv-files";
import { EXPORT_FORMATS } from "../../shared/export";
import {
    saveExport,
    saveImage,
    showExportInFolder
} from "../export/export-files";
import { openKicadProject } from "../project/kicad-files";
import {
    applyKicadProjectUpdate,
    planKicadProjectUpdate,
    restoreKicadBackup,
    showKicadBackup
} from "../project/kicad-update";
import {
    addBomsDialog,
    chooseHistoryDialog,
    createBomList,
    saveBomList,
    saveBomListAs,
    saveBomsWithBackup,
    showListBackup
} from "../project/list-files";
import { openDocumentDialog, openPath } from "../project/open-path";
import { saveProject } from "../project/project-files";
import { onRecentChange, recentDocuments, removeRecent } from "../recent";
import { handle, on } from "./handle";
import { pngSchema } from "./schemas";

const cellSchema = z.union([z.string().max(10_000), z.number(), z.null()]);
const exportRequestSchema = z.object({
    format: z.enum(EXPORT_FORMATS),
    suggestedName: z.string().max(200),
    sheets: z
        .array(
            z.object({
                name: z.string().min(1).max(31),
                rows: z.array(z.array(cellSchema).max(500)).max(10_000),
                numberFormats: z.record(z.string(), z.string().max(50)),
                widths: z.array(z.number().min(1).max(255)).max(500)
            })
        )
        .min(1)
        .max(2),
    decimalComma: z.boolean()
});

const absolutePath = z.string().refine(isAbsolute, "Not an absolute path");

const listStateSchema = z.object({
    filePath: absolutePath,
    boms: z.array(absolutePath).max(1000),
    perDevice: z.record(
        z.string(),
        z.number().int().min(1).max(MAX_PER_DEVICE)
    ),
    history: absolutePath.nullable(),
    buildQuantity: z.number().int().min(1).max(MAX_BUILD_QUANTITY),
    description: z.string().max(MAX_LIST_DESCRIPTION)
});

const kicadUpdateSchema = z.object({
    projectPath: absolutePath.refine(
        path => path.toLowerCase().endsWith(".kicad_pro"),
        "Not a KiCad project"
    ),
    variant: z.string().min(1).max(200),
    columns: z
        .array(
            z.object({
                key: z.string().max(200),
                label: z.string().max(200),
                supplier: z.enum(SUPPLIER_IDS).optional(),
                field: z.string().max(200).optional()
            })
        )
        .max(200),
    rows: z
        .array(
            z.object({
                reference: z.string().max(100_000),
                values: z.record(z.string(), z.string().max(10_000))
            })
        )
        .max(50_000)
});

const saveOptionsSchema = z.object({
    filePath: z.string().nullable(),
    saveAs: z.boolean(),
    suggestedName: z.string().optional(),
    recent: z.boolean().optional()
});

export function registerProjectHandlers(): void {
    handle(IpcChannel.ProjectOpen, ({ window }) => openDocumentDialog(window));
    handle(IpcChannel.ProjectSave, ({ window }, project, options) =>
        saveProject(
            window,
            validateProject(project),
            saveOptionsSchema.parse(options)
        )
    );
    handle(IpcChannel.CsvOpen, ({ window }) => openCsvFile(window));
    handle(IpcChannel.ListCreate, ({ window }) => createBomList(window));
    handle(IpcChannel.ListSave, (_context, list) =>
        saveBomList(listStateSchema.parse(list))
    );
    handle(IpcChannel.ListSaveAs, ({ window }, list) =>
        saveBomListAs(window, listStateSchema.parse(list))
    );
    handle(IpcChannel.ListAddBoms, ({ window }) => addBomsDialog(window));
    handle(IpcChannel.ListChooseHistory, ({ window }) =>
        chooseHistoryDialog(window)
    );
    handle(IpcChannel.ListSaveBoms, (_context, listPath, boms) =>
        saveBomsWithBackup(
            absolutePath.parse(listPath),
            z
                .array(
                    z.object({ filePath: absolutePath, project: z.unknown() })
                )
                .max(1000)
                .parse(boms)
                .map(bom => ({
                    filePath: bom.filePath,
                    project: validateProject(bom.project)
                }))
        )
    );
    on(IpcChannel.ListShowBackup, (_context, folder) =>
        showListBackup(z.string().parse(folder))
    );
    handle(IpcChannel.FilesOpenPath, ({ window }, path) =>
        openPath(window, absolutePath.parse(path))
    );
    handle(IpcChannel.RecentList, () => recentDocuments());
    onRecentChange(() => {
        for (const window of BrowserWindow.getAllWindows()) {
            window.webContents.send(
                IpcChannel.RecentChanged,
                recentDocuments()
            );
        }
    });
    handle(IpcChannel.RecentRemove, (_context, path) =>
        removeRecent(z.string().parse(path))
    );
    handle(IpcChannel.KicadOpen, ({ window }) => openKicadProject(window));
    handle(IpcChannel.KicadPlanUpdate, (_context, request) =>
        planKicadProjectUpdate(kicadUpdateSchema.parse(request))
    );
    handle(IpcChannel.KicadApplyUpdate, (_context, request, columns) =>
        applyKicadProjectUpdate(
            kicadUpdateSchema.parse(request),
            z.array(z.string()).parse(columns)
        )
    );
    handle(IpcChannel.KicadRestoreBackup, ({ window }, folder) =>
        restoreKicadBackup(window, z.string().parse(folder))
    );
    on(IpcChannel.KicadShowBackup, (_context, folder) =>
        showKicadBackup(z.string().parse(folder))
    );
    handle(IpcChannel.ExportSave, ({ window }, request) => {
        const { format, suggestedName, sheets, decimalComma } =
            exportRequestSchema.parse(request);
        return saveExport(window, format, suggestedName, sheets, {
            decimalComma
        });
    });
    handle(IpcChannel.ExportSaveImage, ({ window }, png, suggestedName) =>
        saveImage(
            window,
            pngSchema.parse(png),
            z.string().max(200).parse(suggestedName)
        )
    );
    on(IpcChannel.ExportShowInFolder, (_context, path) =>
        showExportInFolder(z.string().parse(path))
    );
}
