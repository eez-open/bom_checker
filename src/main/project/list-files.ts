import { copyFile, readFile } from "node:fs/promises";
import {
    basename,
    dirname,
    extname,
    join,
    relative,
    resolve,
    sep
} from "node:path";
import { dialog, shell, type BrowserWindow } from "electron";
import {
    BOM_LIST_FILE_EXTENSION,
    BOM_LIST_SCHEMA_VERSION,
    parseBomListFile,
    serializeBomList
} from "../../shared/bom-list-file";
import type {
    ListState,
    OpenedList,
    OpenedListBom,
    OpenedProject
} from "../../shared/ipc";
import type { Project } from "../../shared/model";
import { createHistoryProject } from "../../shared/parts-history";
import {
    PROJECT_FILE_EXTENSION,
    serializeProject
} from "../../shared/project-file";
import { exists, MANIFEST, newBackupFolder } from "../backups";
import { dialogStart, rememberFolder } from "../dialog-folders";
import { showError } from "../dialogs";
import { isFileNotFound, writeFileAtomic } from "../files";
import { log } from "../logging";
import { addRecent } from "../recent";
import {
    isKnownProjectPath,
    pickProjectFiles,
    readBomFile,
    rememberProjectPath,
    writeBomFile
} from "./project-files";

// BOM lists (#35): a .eezbom-list names BOMs whose part numbers are
// unified, and a history BOM. Main reads the BOMs; the renderer may only
// save lists main has read or created, naming BOMs main has read.

const FILTERS = [
    { name: "EEZ BOM checker list", extensions: [BOM_LIST_FILE_EXTENSION] }
];

const knownLists = new Set<string>();
// BOMs named by lists that were read, also the ones that couldn't be.
const listEntries = new Set<string>();
const knownBackups = new Set<string>();

/** A path as stored in the list: relative to its folder, "/" separators. */
function toEntry(listPath: string, path: string): string {
    return relative(dirname(listPath), path).split(sep).join("/");
}

function fromEntry(listPath: string, entry: string): string {
    return resolve(dirname(listPath), entry);
}

function errorText(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

async function readMember(path: string): Promise<OpenedListBom> {
    listEntries.add(path);
    try {
        const { project, supplierDataInFile } = await readBomFile(path);
        rememberProjectPath(path);
        return { path, project, supplierDataInFile };
    } catch (error) {
        log.warn("Can't read list BOM", path, error);
        return {
            path,
            project: null,
            error: isFileNotFound(error)
                ? "The file doesn't exist. It may have been moved or renamed."
                : errorText(error)
        };
    }
}

/** Reads a list and its BOMs; shows why when the list can't be read. */
export async function readBomList(
    window: BrowserWindow,
    path: string
): Promise<OpenedList | null> {
    try {
        const list = parseBomListFile(await readFile(path, "utf8"));
        knownLists.add(path);
        const boms = await Promise.all(
            list.boms.map(entry => readMember(fromEntry(path, entry.path)))
        );
        const history = list.history
            ? await readMember(fromEntry(path, list.history))
            : null;
        addRecent(path);
        log.info("Opened list", path);
        return {
            filePath: path,
            boms,
            history,
            perDevice: Object.fromEntries(
                list.boms.map(entry => [
                    fromEntry(path, entry.path),
                    entry.perDevice
                ])
            ),
            buildQuantity: list.buildQuantity
        };
    } catch (error) {
        log.warn("Can't open", path, error);
        await showError(window, `Can't open "${basename(path)}"`, error);
        return null;
    }
}

async function writeList(list: ListState): Promise<void> {
    const path = list.filePath;
    await writeFileAtomic(
        path,
        serializeBomList({
            schemaVersion: BOM_LIST_SCHEMA_VERSION,
            boms: list.boms.map(bom => ({
                path: toEntry(path, bom),
                perDevice: list.perDevice[bom] ?? 1
            })),
            history: list.history && toEntry(path, list.history),
            buildQuantity: list.buildQuantity
        })
    );
}

/**
 * Asks where to save a new list and creates it, with "<list> history.eezbom"
 * next to it as the history BOM: a new one, or the one already there.
 */
export async function createBomList(
    window: BrowserWindow
): Promise<OpenedList | null> {
    const result = await dialog.showSaveDialog(window, {
        title: "New BOM List",
        defaultPath: dialogStart("bom", `BOM list.${BOM_LIST_FILE_EXTENSION}`),
        filters: FILTERS
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    // Some Linux file dialogs don't add the extension.
    const path =
        extname(result.filePath) === ""
            ? `${result.filePath}.${BOM_LIST_FILE_EXTENSION}`
            : result.filePath;
    rememberFolder("bom", path);
    const historyPath = join(
        dirname(path),
        `${basename(path, extname(path))} history.${PROJECT_FILE_EXTENSION}`
    );
    try {
        if (!(await exists(historyPath))) {
            await writeFileAtomic(
                historyPath,
                serializeProject(createHistoryProject())
            );
        }
        const history = await readMember(historyPath);
        await writeList({
            filePath: path,
            boms: [],
            perDevice: {},
            history: historyPath,
            buildQuantity: 1
        });
        knownLists.add(path);
        addRecent(path);
        log.info("Created list", path);
        return {
            filePath: path,
            boms: [],
            history,
            perDevice: {},
            buildQuantity: 1
        };
    } catch (error) {
        log.warn("Can't create", path, error);
        await showError(window, `Can't create "${basename(path)}"`, error);
        return null;
    }
}

function checkList(listPath: string): void {
    if (!knownLists.has(listPath)) {
        throw new Error("Only a list that was opened can be saved.");
    }
}

function checkBom(path: string): void {
    if (!isKnownProjectPath(path) && !listEntries.has(path)) {
        throw new Error(`${path} wasn't opened as a BOM.`);
    }
}

export async function saveBomList(list: ListState): Promise<void> {
    checkList(list.filePath);
    for (const path of [
        ...list.boms,
        ...(list.history ? [list.history] : [])
    ]) {
        checkBom(path);
    }
    await writeList(list);
    log.info("Saved list", list.filePath);
}

async function readPicked(
    window: BrowserWindow,
    paths: readonly string[]
): Promise<OpenedProject[]> {
    const read = await Promise.all(paths.map(readMember));
    const failed = read.filter(bom => !bom.project);
    if (failed.length > 0) {
        await showError(
            window,
            failed.length === 1
                ? `Can't add "${basename(failed[0]!.path)}"`
                : `Can't add ${failed.length} BOMs`,
            new Error(
                failed
                    .map(bom => `${basename(bom.path)}: ${bom.error}`)
                    .join("\n")
            )
        );
    }
    return read.flatMap(({ path, project, supplierDataInFile }) =>
        project ? [{ filePath: path, project, supplierDataInFile }] : []
    );
}

export async function addBomsDialog(
    window: BrowserWindow
): Promise<OpenedProject[]> {
    const paths = await pickProjectFiles(window, "Add BOMs to the List", true);
    return paths ? readPicked(window, paths) : [];
}

export async function chooseHistoryDialog(
    window: BrowserWindow
): Promise<OpenedProject | null> {
    const paths = await pickProjectFiles(
        window,
        "Choose the History BOM",
        false
    );
    return paths ? ((await readPicked(window, paths))[0] ?? null) : null;
}

/**
 * Saves BOMs of a list after copying their files to a backup folder next
 * to the list (bom-checker-backups/<time>/). Returns the folder.
 */
export async function saveBomsWithBackup(
    listPath: string,
    boms: readonly { filePath: string; project: Project }[]
): Promise<string> {
    checkList(listPath);
    for (const { filePath } of boms) {
        checkBom(filePath);
    }
    const folder = await newBackupFolder(dirname(listPath));
    const used = new Set<string>();
    const files = [];
    for (const { filePath } of boms) {
        // BOMs from different folders may have the same name.
        let copy = basename(filePath);
        for (let n = 2; used.has(copy.toLowerCase()); n++) {
            copy = `${basename(filePath, extname(filePath))} (${n})${extname(filePath)}`;
        }
        used.add(copy.toLowerCase());
        await copyFile(filePath, join(folder, copy));
        files.push({ original: filePath, copy });
    }
    // Paths relative to the backup folder (#34).
    const inBackup = (path: string) =>
        relative(folder, path).split(sep).join("/");
    await writeFileAtomic(
        join(folder, MANIFEST),
        JSON.stringify(
            {
                list: inBackup(listPath),
                createdAt: new Date().toISOString(),
                files: files.map(({ original, copy }) => ({
                    original: inBackup(original),
                    copy
                }))
            },
            null,
            2
        )
    );
    knownBackups.add(folder);
    const written: typeof files = [];
    try {
        for (const [index, { filePath, project }] of boms.entries()) {
            await writeBomFile(filePath, project);
            written.push(files[index]!);
        }
    } catch (error) {
        for (const { original, copy } of written) {
            await writeFileAtomic(original, await readFile(join(folder, copy)));
        }
        throw new Error(
            `Couldn't save the BOMs, so they were left as they were: ${errorText(error)}`,
            { cause: error }
        );
    }
    log.info(`Saved ${boms.length} BOMs of`, listPath, "backup in", folder);
    return folder;
}

export function showListBackup(folder: string): void {
    if (knownBackups.has(folder)) {
        shell.showItemInFolder(join(folder, MANIFEST));
    }
}
