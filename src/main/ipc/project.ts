import { z } from "zod";
import { IpcChannel } from "../../shared/ipc";
import { validateProject } from "../../shared/project-file";
import { openCsvFile } from "../project/csv-files";
import { EXPORT_FORMATS } from "../../shared/export";
import { saveExport, showExportInFolder } from "../export/export-files";
import { openKicadProject } from "../project/kicad-files";
import { openProject, saveProject } from "../project/project-files";
import { handle, on } from "./handle";

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
        .max(2)
});

const saveOptionsSchema = z.object({
    filePath: z.string().nullable(),
    saveAs: z.boolean(),
    suggestedName: z.string().optional()
});

export function registerProjectHandlers(): void {
    handle(IpcChannel.ProjectOpen, ({ window }) => openProject(window));
    handle(IpcChannel.ProjectSave, ({ window }, project, options) =>
        saveProject(
            window,
            validateProject(project),
            saveOptionsSchema.parse(options)
        )
    );
    handle(IpcChannel.CsvOpen, ({ window }) => openCsvFile(window));
    handle(IpcChannel.KicadOpen, ({ window }) => openKicadProject(window));
    handle(IpcChannel.ExportSave, ({ window }, request) => {
        const { format, suggestedName, sheets } =
            exportRequestSchema.parse(request);
        return saveExport(window, format, suggestedName, sheets);
    });
    on(IpcChannel.ExportShowInFolder, (_context, path) =>
        showExportInFolder(z.string().parse(path))
    );
}
