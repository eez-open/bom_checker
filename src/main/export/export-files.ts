import { basename, extname } from "node:path";
import { dialog, shell, type BrowserWindow } from "electron";
import type { ExportFormat, ExportSheet } from "../../shared/export";
import { showError } from "../dialogs";
import { writeFileAtomic } from "../files";
import { log } from "../logging";
import { exportFile } from "./write";

const FILTERS: Record<ExportFormat, Electron.FileFilter> = {
    xlsx: { name: "Excel workbook", extensions: ["xlsx"] },
    ods: { name: "OpenDocument spreadsheet", extensions: ["ods"] },
    csv: { name: "CSV file", extensions: ["csv"] }
};

// Files written by an export; only these can be shown in the folder.
const exported = new Set<string>();

export async function saveExport(
    window: BrowserWindow,
    format: ExportFormat,
    suggestedName: string,
    sheets: readonly ExportSheet[]
): Promise<string | null> {
    const result = await dialog.showSaveDialog(window, {
        title: "Export BOM",
        defaultPath: `${basename(suggestedName)}.${format}`,
        filters: [FILTERS[format]]
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    const path =
        extname(result.filePath) === ""
            ? `${result.filePath}.${format}`
            : result.filePath;
    try {
        await writeFileAtomic(path, exportFile(format, sheets));
        exported.add(path);
        log.info("Exported", path);
        return path;
    } catch (error) {
        log.warn("Export failed", path, error);
        const busy = ["EBUSY", "EPERM", "EACCES"].includes(
            (error as NodeJS.ErrnoException).code ?? ""
        );
        await showError(
            window,
            `Can't save "${basename(path)}"`,
            busy
                ? new Error(
                      "The file may be open in another program. Close it there and export again."
                  )
                : error
        );
        return null;
    }
}

export function showExportInFolder(path: string): void {
    if (exported.has(path)) {
        shell.showItemInFolder(path);
    }
}
