import { copyFile, mkdir, readFile, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { shell, type BrowserWindow } from "electron";
import { z } from "zod";
import type {
    KicadUpdatePlan,
    KicadUpdateRequest,
    KicadUpdateResult
} from "../../shared/ipc";
import { confirm } from "../dialogs";
import { writeFileAtomic } from "../files";
import { readKicadDesign, type KicadDesign } from "../kicad/project";
import { applyEdits, planKicadUpdate, relativeFiles } from "../kicad/update";
import { log } from "../logging";

// Writing BOM columns back into a KiCad project (GitHub #11). Every update
// first copies the project's files to bom-checker-backups/<time>/ next to
// the project, with a backup.json listing where each copy came from.

const BACKUP_FOLDER = "bom-checker-backups";
const MANIFEST = "backup.json";

const manifestSchema = z.object({
    project: z.string(),
    createdAt: z.string(),
    files: z.array(z.object({ original: z.string(), copy: z.string() }))
});

/** Backups made in this session; only these can be restored from the UI. */
const knownBackups = new Set<string>();

async function readDesign(
    projectPath: string
): Promise<{ design: KicadDesign; texts: Map<string, string> }> {
    const texts = new Map<string, string>();
    const design = await readKicadDesign(projectPath, async path => {
        const text = await readFile(path, "utf8");
        texts.set(path, text);
        return text;
    });
    return { design, texts };
}

async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

/** KiCad keeps "~<file>.lck" next to a schematic while it's open. */
async function openInKicad(design: KicadDesign): Promise<string[]> {
    const open: string[] = [];
    for (const file of [design.path, ...design.files.keys()]) {
        if (await exists(join(dirname(file), `~${basename(file)}.lck`))) {
            open.push(basename(file));
        }
    }
    return open;
}

export async function planKicadProjectUpdate(
    request: KicadUpdateRequest
): Promise<KicadUpdatePlan> {
    const { design } = await readDesign(request.projectPath);
    const { plan } = planKicadUpdate(design, request);
    const open = await openInKicad(design);
    if (open.length > 0) {
        plan.warnings.unshift(
            `KiCad has ${open.join(", ")} open. Close the schematic in KiCad first: ` +
                "saving it there would overwrite the update."
        );
    }
    return plan;
}

function timestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

/** Copies the project file and all its schematics; returns the folder. */
async function backUp(design: KicadDesign): Promise<string> {
    const projectFolder = dirname(design.path);
    const base = join(projectFolder, BACKUP_FOLDER, timestamp(new Date()));
    let folder = base;
    for (let n = 2; await exists(folder); n++) {
        folder = `${base}-${n}`;
    }
    const files = [];
    for (const original of [design.path, ...design.files.keys()]) {
        const inside = relative(projectFolder, original);
        const copy =
            inside.startsWith("..") || isAbsolute(inside)
                ? join("outside-project", basename(original))
                : inside;
        await mkdir(dirname(join(folder, copy)), { recursive: true });
        await copyFile(original, join(folder, copy));
        files.push({ original, copy });
    }
    await writeFileAtomic(
        join(folder, MANIFEST),
        JSON.stringify(
            {
                project: design.path,
                createdAt: new Date().toISOString(),
                files
            },
            null,
            2
        )
    );
    knownBackups.add(folder);
    log.info("Backed up KiCad project to", folder);
    return folder;
}

export async function applyKicadProjectUpdate(
    request: KicadUpdateRequest,
    columns: readonly string[]
): Promise<KicadUpdateResult> {
    const { design, texts } = await readDesign(request.projectPath);
    const { plan, edits } = planKicadUpdate(design, request, new Set(columns));
    // Checked before anything is written.
    const changed = applyEdits(edits, texts);
    if (changed.size === 0) {
        throw new Error("There's nothing to change in the KiCad project.");
    }

    const backupFolder = await backUp(design);
    const written: string[] = [];
    try {
        for (const [file, text] of changed) {
            await writeFileAtomic(file, text);
            written.push(file);
        }
    } catch (error) {
        for (const file of written) {
            await writeFileAtomic(file, texts.get(file)!);
        }
        throw new Error(
            `Couldn't write the KiCad project, so it was left as it was: ${error instanceof Error ? error.message : String(error)}`,
            { cause: error }
        );
    }
    log.info(
        `Updated ${plan.changes.length} fields in`,
        [...changed.keys()].join(", ")
    );
    return {
        changes: plan.changes.length,
        files: relativeFiles(dirname(design.path), changed.keys()),
        backupFolder
    };
}

/** Puts the files of a backup made in this session back. */
export async function restoreKicadBackup(
    window: BrowserWindow,
    folder: string
): Promise<boolean> {
    if (!knownBackups.has(folder)) {
        throw new Error(
            "Only a backup made in this session can be restored here."
        );
    }
    const manifest = manifestSchema.parse(
        JSON.parse(await readFile(join(folder, MANIFEST), "utf8"))
    );
    const confirmed = await confirm(window, {
        message: "Put the KiCad project back as it was before the update?",
        detail:
            `The files are copied back from ${folder}. Changes made in KiCad ` +
            "since the update are lost.",
        confirmLabel: "Restore"
    });
    if (!confirmed) {
        return false;
    }
    for (const { original, copy } of manifest.files) {
        await writeFileAtomic(original, await readFile(join(folder, copy)));
    }
    log.info("Restored KiCad project from", folder);
    return true;
}

export function showKicadBackup(folder: string): void {
    if (knownBackups.has(folder)) {
        shell.showItemInFolder(join(folder, MANIFEST));
    }
}
