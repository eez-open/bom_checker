import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";

// Copies of files from before the app changes them: a KiCad project before
// Update KiCad…, or a list's BOMs before Unify's Apply. Each backup is a
// folder bom-checker-backups/<time>/ with a backup.json listing where each
// copy came from.

export const BACKUP_FOLDER = "bom-checker-backups";
export const MANIFEST = "backup.json";

export async function exists(path: string): Promise<boolean> {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
}

function timestamp(date: Date): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return (
        `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}_` +
        `${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
    );
}

/** Creates a new, empty backup folder in `parent`; returns its path. */
export async function newBackupFolder(parent: string): Promise<string> {
    const base = join(parent, BACKUP_FOLDER, timestamp(new Date()));
    let folder = base;
    for (let n = 2; await exists(folder); n++) {
        folder = `${base}-${n}`;
    }
    await mkdir(folder, { recursive: true });
    return folder;
}
