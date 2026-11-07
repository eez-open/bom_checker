import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { app } from "electron";
import { writeFileAtomic } from "./files";
import { log } from "./logging";

// The folders file dialogs start in (#59): each kind of dialog opens in
// the folder of the file last chosen in one of its kind, also after a
// restart. Kept in dialog-folders.json in the profile folder.

/** BOMs and lists (open, save, new list, add to a list), CSV files and
 *  KiCad projects to import, and exported files and pictures. */
export type DialogKind = "bom" | "csv" | "kicad" | "export";

const KINDS: readonly DialogKind[] = ["bom", "csv", "kicad", "export"];

type Folders = Partial<Record<DialogKind, string>>;

let folders: Folders | null = null;

function foldersPath(): string {
    return join(app.getPath("userData"), "dialog-folders.json");
}

function load(): Folders {
    if (!folders) {
        folders = {};
        try {
            const saved = JSON.parse(
                readFileSync(foldersPath(), "utf8")
            ) as Record<string, unknown>;
            for (const kind of KINDS) {
                const folder = saved[kind];
                if (typeof folder === "string" && folder !== "") {
                    folders[kind] = folder;
                }
            }
        } catch {
            // First start, or unreadable: the system chooses.
        }
    }
    return folders;
}

/**
 * Where a dialog of `kind` starts: the remembered folder, with `fileName`
 * in it when given. Without a folder (or when it's gone), just the name,
 * and the system chooses the folder.
 */
export function dialogStart(
    kind: DialogKind,
    fileName?: string
): string | undefined {
    const folder = load()[kind];
    if (!folder || !existsSync(folder)) {
        return fileName;
    }
    return fileName ? join(folder, fileName) : folder;
}

// Writes run one after another, so the newest folders are saved last.
let saving = Promise.resolve();

/** Remembers the folder of a file chosen in a dialog of `kind`. */
export function rememberFolder(kind: DialogKind, filePath: string): void {
    const folder = dirname(filePath);
    const current = load();
    if (current[kind] === folder) {
        return;
    }
    const next = { ...current, [kind]: folder };
    folders = next;
    saving = saving
        .then(() =>
            writeFileAtomic(foldersPath(), JSON.stringify(next, null, 2))
        )
        .catch((error: unknown) =>
            log.warn("Can't save the dialogs' folders:", error)
        );
}
