// The .eezbom-list file (#35): BOMs whose part numbers are unified, such
// as the modules of one device, and the BOM that keeps the history of
// parts used before. Paths are relative to the list's folder, with "/"
// separators, so the folder can be moved or shared.

import { z } from "zod";
import { MAX_BUILD_QUANTITY } from "./model";

export const BOM_LIST_FILE_EXTENSION = "eezbom-list";
/** 2 added how many of each BOM a device has, and how many devices
 *  (#39); 3 a description (#72). */
export const BOM_LIST_SCHEMA_VERSION = 3;

/** The most of one BOM a device can have (#39). */
export const MAX_PER_DEVICE = 1000;

/** The longest description of a list, in characters (#72). */
export const MAX_LIST_DESCRIPTION = 10_000;

export interface BomListEntry {
    path: string;
    /** How many of this BOM one device has, e.g. 2 of a module. */
    perDevice: number;
}

export interface BomListFile {
    schemaVersion: typeof BOM_LIST_SCHEMA_VERSION;
    /** The BOMs, in the order they are shown. */
    boms: BomListEntry[];
    /** The BOM with the parts used before; null if there is none. */
    history: string | null;
    /** How many devices the Combined BOM is for. */
    buildQuantity: number;
    /** General information about the list, typed in by the user (#72). */
    description: string;
}

export class BomListFileError extends Error {
    override name = "BomListFileError";
}

const path = z.string().min(1).max(1000);

const listSchema: z.ZodType<BomListFile> = z.object({
    schemaVersion: z.literal(BOM_LIST_SCHEMA_VERSION),
    boms: z
        .array(
            z.object({
                path,
                perDevice: z.number().int().min(1).max(MAX_PER_DEVICE)
            })
        )
        .max(1000),
    history: path.nullable(),
    buildQuantity: z.number().int().min(1).max(MAX_BUILD_QUANTITY),
    description: z.string().max(MAX_LIST_DESCRIPTION)
});

/** Version 1 named the BOMs only: one of each per device, one device.
 *  Versions 1 and 2 had no description. */
function migrate(data: unknown): unknown {
    let file = data as {
        schemaVersion?: unknown;
        boms?: unknown;
        [field: string]: unknown;
    } | null;
    if (file?.schemaVersion === 1 && Array.isArray(file.boms)) {
        file = {
            ...file,
            schemaVersion: 2,
            boms: file.boms.map((entry: unknown) => ({
                path: entry,
                perDevice: 1
            })),
            buildQuantity: 1
        };
    }
    if (file?.schemaVersion === 2) {
        file = {
            ...file,
            schemaVersion: BOM_LIST_SCHEMA_VERSION,
            description: ""
        };
    }
    return file;
}

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
    const result = listSchema.safeParse(migrate(data));
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
