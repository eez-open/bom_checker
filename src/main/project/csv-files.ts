import { readFile, stat } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { OpenedFile } from "../../shared/ipc";
import { showError } from "../dialogs";
import { log } from "../logging";
import { addRecent } from "../recent";

// BOM CSV files are a few kB; anything this large is the wrong file.
const MAX_SIZE = 10 * 1024 * 1024;

/** Lets the user pick a CSV file and returns its raw bytes; the renderer
 *  decodes them, because the user may need to choose the text encoding. */
export async function openCsvFile(
    window: BrowserWindow
): Promise<OpenedFile | null> {
    const result = await dialog.showOpenDialog(window, {
        title: "Import CSV",
        filters: [
            { name: "CSV files", extensions: ["csv", "txt"] },
            { name: "All files", extensions: ["*"] }
        ],
        properties: ["openFile"]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
        return null;
    }
    return readCsvFile(window, filePath);
}

/** Reads a CSV file to import; shows why when it can't. */
export async function readCsvFile(
    window: BrowserWindow,
    filePath: string
): Promise<OpenedFile | null> {
    try {
        const { size } = await stat(filePath);
        if (size > MAX_SIZE) {
            throw new Error(
                `The file is ${(size / 1024 / 1024).toFixed(0)} MB; ` +
                    "a BOM exported as CSV is normally well under 1 MB."
            );
        }
        const bytes = new Uint8Array(await readFile(filePath));
        addRecent(filePath);
        return { filePath, fileName: basename(filePath), bytes };
    } catch (error) {
        log.warn("Can't read", filePath, error);
        await showError(window, `Can't read "${basename(filePath)}"`, error);
        return null;
    }
}
