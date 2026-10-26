import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/** Writes to a temporary file first, so a failed write never leaves a
 *  half-written file behind. */
export async function writeFileAtomic(
    path: string,
    content: string | Uint8Array
): Promise<void> {
    const temporary = `${path}.${randomUUID()}.tmp`;
    try {
        await writeFile(temporary, content);
        await rename(temporary, path);
    } catch (error) {
        await rm(temporary, { force: true });
        throw error;
    }
}

export function isFileNotFound(error: unknown): boolean {
    return (error as NodeJS.ErrnoException | null)?.code === "ENOENT";
}
