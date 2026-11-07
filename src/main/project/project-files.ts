import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { app, dialog, type BrowserWindow } from "electron";
import type { OpenedProject, SaveOptions } from "../../shared/ipc";
import type { Project } from "../../shared/model";
import {
    PROJECT_FILE_EXTENSION,
    hasCollectedData,
    hasManualPrices,
    manualPricesOf,
    parseProjectFile,
    serializeProject,
    withManualPrices,
    type ManualPrices
} from "../../shared/project-file";
import { dialogStart, rememberFolder } from "../dialog-folders";
import { showError } from "../dialogs";
import { writeFileAtomic } from "../files";
import { log } from "../logging";
import { addRecent } from "../recent";
import { withAbsoluteSource, withRelativeSource } from "./source-paths";
import {
    SUPPLIER_DATA_FOLDER,
    findSupplierData,
    noSupplierData,
    readSupplierData,
    writeSupplierData,
    type SupplierData
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

/** What's kept on this computer for the BOM at `path`, or, for a BOM
 *  moved or renamed outside the app, for its id (#68). */
async function keptSupplierData(
    path: string,
    bomId: string
): Promise<{ data: SupplierData; moved: boolean }> {
    try {
        const data = await readSupplierData(supplierDataFolder(), path);
        if (hasCollectedData(data.collected) || hasKept(data.manual)) {
            return { data, moved: false };
        }
        const found = await findSupplierData(supplierDataFolder(), bomId);
        return found ? { data: found, moved: true } : { data, moved: false };
    } catch (error) {
        log.warn("Can't read the supplier data of", path, error);
        return { data: noSupplierData(), moved: false };
    }
}

function hasKept(manual: ManualPrices): boolean {
    return Object.keys(manual).length > 0;
}

/**
 * Reads a BOM file, with what's kept for it on this computer: collected
 * supplier data, and the prices typed for suppliers without an API (#68).
 * Older files have them in the file (collected data before format 6,
 * prices before format 8): they're kept on the computer from now on, and
 * the file should be saved again to remove them.
 */
export async function readBomFile(path: string): Promise<OpenedProject> {
    const parsed = withAbsoluteSource(
        parseProjectFile(await readFile(path, "utf8")),
        path
    );
    // Files before format 8 have no id; it's saved with the file.
    const project = parsed.id ? parsed : { ...parsed, id: randomUUID() };
    const kept = await keptSupplierData(path, project.id!);
    const collectedInFile = hasCollectedData(project.collected);
    const pricesInFile = hasManualPrices(project);
    const data: SupplierData = {
        collected: collectedInFile ? project.collected : kept.data.collected,
        manual: pricesInFile ? manualPricesOf(project) : kept.data.manual
    };
    const opened = withManualPrices(
        { ...project, collected: data.collected },
        pricesInFile ? {} : data.manual
    );
    const inFile = collectedInFile || pricesInFile;
    if (inFile || kept.moved) {
        try {
            await writeSupplierData(
                supplierDataFolder(),
                path,
                data,
                project.id
            );
        } catch (error) {
            // Saving the BOM tries again.
            log.warn("Can't keep the supplier data of", path, error);
        }
    }
    return inFile
        ? { filePath: path, project: opened, supplierDataInFile: true }
        : { filePath: path, project: opened };
}

/** Writes a BOM file, and keeps its supplier data on this computer. */
export async function writeBomFile(
    path: string,
    project: Project
): Promise<void> {
    // The data first: if the file can't be written, the data kept for the
    // old one is still right for its part numbers and rows.
    await writeSupplierData(
        supplierDataFolder(),
        path,
        { collected: project.collected, manual: manualPricesOf(project) },
        project.id
    );
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
        defaultPath: dialogStart("bom"),
        filters: FILTERS,
        properties: multiple ? ["openFile", "multiSelections"] : ["openFile"]
    });
    if (result.canceled || result.filePaths.length === 0) {
        return null;
    }
    rememberFolder("bom", result.filePaths[0]!);
    return result.filePaths;
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
                dialogStart(
                    "bom",
                    basename(
                        suggestedName ?? `Untitled.${PROJECT_FILE_EXTENSION}`
                    )
                ),
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
        rememberFolder("bom", target);
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
