import { stat } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import { BOM_LIST_FILE_EXTENSION } from "../../shared/bom-list-file";
import { documentKind } from "../../shared/document-kind";
import type { OpenedDocument } from "../../shared/ipc";
import { PROJECT_FILE_EXTENSION } from "../../shared/project-file";
import { showError } from "../dialogs";
import { isFileNotFound } from "../files";
import { removeRecent } from "../recent";
import { readCsvFile } from "./csv-files";
import { readKicadProject } from "./kicad-files";
import { readBomList } from "./list-files";
import { readProject } from "./project-files";

/** File → Open…: a BOM or a BOM list (#35). */
export async function openDocumentDialog(
    window: BrowserWindow
): Promise<Extract<OpenedDocument, { kind: "project" | "list" }> | null> {
    const result = await dialog.showOpenDialog(window, {
        title: "Open BOM",
        filters: [
            {
                name: "BOMs and BOM lists",
                extensions: [PROJECT_FILE_EXTENSION, BOM_LIST_FILE_EXTENSION]
            },
            { name: "All files", extensions: ["*"] }
        ],
        properties: ["openFile"]
    });
    const path = result.filePaths[0];
    if (result.canceled || !path) {
        return null;
    }
    if (documentKind(path) === "list") {
        const list = await readBomList(window, path);
        return list && { kind: "list", list };
    }
    const opened = await readProject(window, path);
    return opened && { kind: "project", opened };
}

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
                "Open a BOM (.eezbom), a BOM list (.eezbom-list), a KiCad project (.kicad_pro) or a CSV file."
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
        case "list": {
            const list = await readBomList(window, path);
            return list && { kind, list };
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
