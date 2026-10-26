import { stat } from "node:fs/promises";
import { basename } from "node:path";
import type { BrowserWindow } from "electron";
import { documentKind } from "../../shared/document-kind";
import type { OpenedDocument } from "../../shared/ipc";
import { showError } from "../dialogs";
import { isFileNotFound } from "../files";
import { removeRecent } from "../recent";
import { readCsvFile } from "./csv-files";
import { readKicadProject } from "./kicad-files";
import { readProject } from "./project-files";

/** Opens a file from Open Recent or dropped on the window, by its kind.
 *  Null when it can't; the user has been told why. */
export async function openPath(
    window: BrowserWindow,
    path: string
): Promise<OpenedDocument | null> {
    const kind = documentKind(path);
    if (!kind) {
        await showError(
            window,
            `Can't open "${basename(path)}"`,
            new Error(
                "Open a BOM (.eezbom), a KiCad project (.kicad_pro) or a CSV file."
            )
        );
        return null;
    }
    try {
        await stat(path);
    } catch (error) {
        if (isFileNotFound(error)) {
            removeRecent(path);
            await showError(
                window,
                `Can't open "${basename(path)}"`,
                new Error(
                    `${path} doesn't exist any more, so it was removed from the recent documents.`
                )
            );
            return null;
        }
        // Other problems are reported by the readers below.
    }
    switch (kind) {
        case "project": {
            const opened = await readProject(window, path);
            return opened && { kind, opened };
        }
        case "csv": {
            const file = await readCsvFile(window, path);
            return file && { kind, file };
        }
        case "kicad": {
            const project = await readKicadProject(window, path);
            return project && { kind, project };
        }
    }
}
