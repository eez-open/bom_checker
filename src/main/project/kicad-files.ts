import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { dialog, type BrowserWindow } from "electron";
import type { KicadProjectData } from "../../shared/ipc";
import { showError } from "../dialogs";
import { loadKicadProject } from "../kicad/project";
import { log } from "../logging";
import { addRecent } from "../recent";

/** Lets the user pick a KiCad project and reads its BOM for every design
 *  variant; the renderer then lets the user choose one. */
export async function openKicadProject(
    window: BrowserWindow
): Promise<KicadProjectData | null> {
    const result = await dialog.showOpenDialog(window, {
        title: "Import KiCad project",
        filters: [
            { name: "KiCad project", extensions: ["kicad_pro"] },
            { name: "All files", extensions: ["*"] }
        ],
        properties: ["openFile"]
    });
    const projectPath = result.filePaths[0];
    if (result.canceled || !projectPath) {
        return null;
    }
    return readKicadProject(window, projectPath);
}

/** Reads a KiCad project's BOM; shows why when it can't. */
export async function readKicadProject(
    window: BrowserWindow,
    projectPath: string
): Promise<KicadProjectData | null> {
    try {
        const project = await loadKicadProject(projectPath, path =>
            readFile(path, "utf8")
        );
        log.info(
            "Read KiCad project",
            projectPath,
            project.variants
                .map(v => `${v.name}: ${v.partCount} parts`)
                .join(", ")
        );
        addRecent(projectPath);
        return project;
    } catch (error) {
        log.warn("Can't read KiCad project", projectPath, error);
        await showError(
            window,
            `Can't import "${basename(projectPath)}"`,
            error
        );
        return null;
    }
}
