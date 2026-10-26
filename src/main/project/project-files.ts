import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import { basename, extname } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { OpenedProject, SaveOptions } from "../../shared/ipc";
import type { Project } from "../../shared/model";
import {
    PROJECT_FILE_EXTENSION,
    parseProjectFile,
    serializeProject
} from "../../shared/project-file";
import { showError } from "../dialogs";
import { log } from "../logging";

const FILTERS = [
    { name: "EEZ BOM checker project", extensions: [PROJECT_FILE_EXTENSION] },
    { name: "All files", extensions: ["*"] }
];

// Paths the user picked in an Open or Save dialog. The renderer can only
// save to one of these without a dialog, so it can't write files elsewhere.
const knownPaths = new Set<string>();

export async function openProject(
    window: BrowserWindow
): Promise<OpenedProject | null> {
    const result = await dialog.showOpenDialog(window, {
        title: "Open BOM",
        filters: FILTERS,
        properties: ["openFile"]
    });
    const filePath = result.filePaths[0];
    if (result.canceled || !filePath) {
        return null;
    }
    try {
        const project = parseProjectFile(await readFile(filePath, "utf8"));
        knownPaths.add(filePath);
        log.info("Opened", filePath);
        return { filePath, project };
    } catch (error) {
        log.warn("Can't open", filePath, error);
        await showError(window, `Can't open "${basename(filePath)}"`, error);
        return null;
    }
}

export async function saveProject(
    window: BrowserWindow,
    project: Project,
    { filePath, saveAs, suggestedName }: SaveOptions
): Promise<string | null> {
    let target =
        !saveAs && filePath && knownPaths.has(filePath) ? filePath : null;
    if (!target) {
        const result = await dialog.showSaveDialog(window, {
            title: saveAs ? "Save BOM As" : "Save BOM",
            // Only a name is taken from the renderer, never a folder.
            defaultPath:
                filePath ??
                basename(suggestedName ?? `Untitled.${PROJECT_FILE_EXTENSION}`),
            filters: FILTERS.slice(0, 1)
        });
        if (result.canceled || !result.filePath) {
            return null;
        }
        // Some Linux file dialogs don't add the extension.
        target =
            extname(result.filePath) === ""
                ? `${result.filePath}.${PROJECT_FILE_EXTENSION}`
                : result.filePath;
    }
    try {
        await writeFileAtomic(target, serializeProject(project));
        knownPaths.add(target);
        log.info("Saved", target);
        return target;
    } catch (error) {
        log.warn("Can't save", target, error);
        await showError(window, `Can't save "${basename(target)}"`, error);
        return null;
    }
}

/** Writes to a temporary file first, so a failed save never leaves a
 *  half-written project behind. */
async function writeFileAtomic(path: string, content: string): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content, "utf8");
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}
