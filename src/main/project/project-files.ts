import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import type { OpenedProject, SaveOptions } from "../../shared/ipc";
import type { CollectedData, Project } from "../../shared/model";
import {
    PROJECT_FILE_EXTENSION,
    hasCollectedData,
    parseProjectFile,
    serializeProject
} from "../../shared/project-file";
import { showError } from "../dialogs";
import { writeFileAtomic } from "../files";
import { log } from "../logging";
import { addRecent } from "../recent";
import { withAbsoluteSource, withRelativeSource } from "./source-paths";
import {
    SUPPLIER_DATA_FOLDER,
    readSupplierData,
    writeSupplierData
} from "./supplier-data";

const FILTERS = [
    { name: "EEZ BOM checker project", extensions: [PROJECT_FILE_EXTENSION] },
    { name: "All files", extensions: ["*"] }
];

// Paths of BOMs that were opened or saved. The renderer can only save to
// one of these without a dialog, so it can't write files elsewhere.
const knownPaths = new Set<string>();

export function rememberProjectPath(path: string): void {
    knownPaths.add(path);
}

export function isKnownProjectPath(path: string): boolean {
    return knownPaths.has(path);
}

function supplierDataFolder(): string {
    return join(app.getPath("userData"), SUPPLIER_DATA_FOLDER);
}

async function cachedSupplierData(path: string): Promise<CollectedData> {
    try {
        return await readSupplierData(supplierDataFolder(), path);
    } catch (error) {
        log.warn("Can't read the supplier data of", path, error);
        return { results: {}, runs: {} };
    }
}

/**
 * Reads a BOM file, with the supplier data kept for it on this computer.
 * Files saved before format 6 have the data in them: it's kept on the
 * computer from now on, and the file should be saved again to remove it.
 */
export async function readBomFile(path: string): Promise<OpenedProject> {
    const project = withAbsoluteSource(
        parseProjectFile(await readFile(path, "utf8")),
        path
    );
    if (!hasCollectedData(project.collected)) {
        return {
            filePath: path,
            project: { ...project, collected: await cachedSupplierData(path) }
        };
    }
    try {
        await writeSupplierData(supplierDataFolder(), path, project.collected);
    } catch (error) {
        // Saving the BOM tries again.
        log.warn("Can't keep the supplier data of", path, error);
    }
    return { filePath: path, project, supplierDataInFile: true };
}

/** Writes a BOM file, and keeps its supplier data on this computer. */
export async function writeBomFile(
    path: string,
    project: Project
): Promise<void> {
    // The data first: if the file can't be written, the data kept for the
    // old one is still right for its part numbers.
    await writeSupplierData(supplierDataFolder(), path, project.collected);
    await writeFileAtomic(
        path,
        serializeProject(withRelativeSource(project, path))
    );
}

/** Lets the user pick BOM files; null when cancelled. */
export async function pickProjectFiles(
    window: BrowserWindow,
    title: string,
    multiple: boolean
): Promise<string[] | null> {
    const result = await dialog.showOpenDialog(window, {
        title,
        filters: FILTERS,
        properties: multiple ? ["openFile", "multiSelections"] : ["openFile"]
    });
    return result.canceled || result.filePaths.length === 0
        ? null
        : result.filePaths;
}

/** Reads a BOM; shows why when it can't. */
export async function readProject(
    window: BrowserWindow,
    filePath: string
): Promise<OpenedProject | null> {
    try {
        const opened = await readBomFile(filePath);
        knownPaths.add(filePath);
        addRecent(filePath);
        log.info("Opened", filePath);
        return opened;
    } catch (error) {
        log.warn("Can't open", filePath, error);
        await showError(window, `Can't open "${basename(filePath)}"`, error);
        return null;
    }
}

export async function saveProject(
    window: BrowserWindow,
    project: Project,
    { filePath, saveAs, suggestedName, recent = true }: SaveOptions
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
        await writeBomFile(target, project);
        knownPaths.add(target);
        if (recent) {
            addRecent(target);
        }
        log.info("Saved", target);
        return target;
    } catch (error) {
        log.warn("Can't save", target, error);
        await showError(window, `Can't save "${basename(target)}"`, error);
        return null;
    }
}
