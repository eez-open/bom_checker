// The .eezbom-list file (#35): BOMs whose part numbers are unified, such
// as the modules of one device, and the BOM that keeps the history of
// parts used before. Paths are relative to the list's folder, with "/"
// separators, so the folder can be moved or shared.

import { z } from "zod";

export const BOM_LIST_FILE_EXTENSION = "eezbom-list";
export const BOM_LIST_SCHEMA_VERSION = 1;

export interface BomListFile {
    schemaVersion: typeof BOM_LIST_SCHEMA_VERSION;
    /** The BOMs, in the order they are shown. */
    boms: string[];
    /** The BOM with the parts used before; null if there is none. */
    history: string | null;
}

export class BomListFileError extends Error {
    override name = "BomListFileError";
}

const path = z.string().min(1).max(1000);

const listSchema: z.ZodType<BomListFile> = z.object({
    schemaVersion: z.literal(BOM_LIST_SCHEMA_VERSION),
    boms: z.array(path).max(1000),
    history: path.nullable()
});

export function parseBomListFile(text: string): BomListFile {
    let data: unknown;
    try {
        data = JSON.parse(text);
    } catch {
        throw new BomListFileError(
            "The file is not an EEZ BOM checker list (it isn't JSON)."
        );
    }
    const version = (data as { schemaVersion?: unknown } | null)?.schemaVersion;
    if (typeof version === "number" && version > BOM_LIST_SCHEMA_VERSION) {
        throw new BomListFileError(
            `The file was saved by a newer version of EEZ BOM checker ` +
                `(list format ${version}). Update the app to open it.`
        );
    }
    const result = listSchema.safeParse(data);
    if (!result.success) {
        throw new BomListFileError(
            "The file is damaged or not an EEZ BOM checker list:\n" +
                z.prettifyError(result.error)
        );
    }
    return result.data;
}

export function serializeBomList(list: BomListFile): string {
    return JSON.stringify(list, null, 2) + "\n";
}
