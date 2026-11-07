import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import { withoutExpired } from "../../shared/collection";
import type { CollectedData } from "../../shared/model";
import {
    collectedSchema,
    hasCollectedData,
    manualPricesSchema,
    type ManualPrices
} from "../../shared/project-file";
import { isFileNotFound, writeFileAtomic } from "../files";

// The supplier data collected for a BOM (stock, prices, descriptions…) is
// kept on this computer, not in the BOM file: the suppliers' API terms
// don't allow passing it on, and BOM files are often published, e.g. on
// GitHub. So are the prices, stock and MOQ typed for suppliers without an
// API (#68), which may be confidential. Each BOM has its own file in the
// folder, named by a hash of the BOM's path. A BOM moved or renamed
// outside the app finds its file by the BOM's id. There is no shared parts
// database (DigiKey's terms forbid one).

export const SUPPLIER_DATA_FOLDER = "supplier-data";

const SCHEMA_VERSION = 2;

/** What's kept on the computer for a BOM. */
export interface SupplierData {
    collected: CollectedData;
    /** Typed for suppliers without an API, by row and supplier (#68). */
    manual: ManualPrices;
}

export function noSupplierData(): SupplierData {
    return { collected: { results: {}, runs: {} }, manual: {} };
}

function hasData(data: SupplierData): boolean {
    return (
        hasCollectedData(data.collected) || Object.keys(data.manual).length > 0
    );
}

// Version 1 had collected data only.
const cacheSchema = z.object({
    schemaVersion: z.union([z.literal(1), z.literal(SCHEMA_VERSION)]),
    bomPath: z.string(),
    bomId: z.string().optional(),
    collected: collectedSchema,
    manual: manualPricesSchema.optional()
});

type Cache = z.infer<typeof cacheSchema>;

function dataOf(cache: Cache): SupplierData {
    return { collected: cache.collected, manual: cache.manual ?? {} };
}

/** The same for every spelling of a path: Windows paths ignore case. */
function normalized(bomPath: string): string {
    const path = resolve(bomPath);
    return process.platform === "win32" ? path.toLowerCase() : path;
}

/** The file in `folder` with the supplier data of the BOM at `bomPath`. */
export function supplierDataFile(folder: string, bomPath: string): string {
    const hash = createHash("sha256").update(normalized(bomPath)).digest("hex");
    return join(folder, `${hash.slice(0, 32)}.json`);
}

/** What's kept for the BOM at `bomPath`; nothing if there is none.
 *  Throws if it can't be read or is damaged. */
export async function readSupplierData(
    folder: string,
    bomPath: string
): Promise<SupplierData> {
    let text: string;
    try {
        text = await readFile(supplierDataFile(folder, bomPath), "utf8");
    } catch (error) {
        if (isFileNotFound(error)) {
            return noSupplierData();
        }
        throw error;
    }
    const cache = cacheSchema.parse(JSON.parse(text));
    return normalized(cache.bomPath) === normalized(bomPath)
        ? dataOf(cache)
        : noSupplierData();
}

/**
 * What's kept for the BOM with this id at another path, e.g. one moved or
 * renamed outside the app; the newest if there are several, as for copies
 * of a BOM. Null if there is none. Files that can't be read are skipped.
 */
export async function findSupplierData(
    folder: string,
    bomId: string
): Promise<SupplierData | null> {
    let names: string[];
    try {
        names = await readdir(folder);
    } catch {
        return null;
    }
    let newest: { data: SupplierData; time: number } | null = null;
    for (const name of names.filter(name => name.endsWith(".json"))) {
        const file = join(folder, name);
        try {
            const text = await readFile(file, "utf8");
            if (!text.includes(bomId)) {
                continue;
            }
            const cache = cacheSchema.parse(JSON.parse(text));
            const time = (await stat(file)).mtimeMs;
            if (cache.bomId === bomId && (!newest || time > newest.time)) {
                newest = { data: dataOf(cache), time };
            }
        } catch {
            // Damaged or being written: not this one.
        }
    }
    return newest?.data ?? null;
}

/** Keeps `data` for the BOM at `bomPath`, with the BOM's id. */
export async function writeSupplierData(
    folder: string,
    bomPath: string,
    data: SupplierData,
    bomId?: string
): Promise<void> {
    const file = supplierDataFile(folder, bomPath);
    if (!hasData(data)) {
        await rm(file, { force: true });
        return;
    }
    await mkdir(folder, { recursive: true });
    await writeFileAtomic(
        file,
        JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            bomPath: resolve(bomPath),
            bomId,
            collected: data.collected,
            manual: data.manual
        }) + "\n"
    );
}

/**
 * Removes data older than its supplier's terms allow (#62: Arrow's, 48
 * hours) from every file in `folder`, also of BOMs that aren't opened
 * again. Files that can't be read are left alone. Returns how many files
 * changed.
 */
export async function pruneSupplierData(
    folder: string,
    now: number
): Promise<number> {
    let names: string[];
    try {
        names = await readdir(folder);
    } catch {
        return 0;
    }
    let changed = 0;
    for (const name of names.filter(name => name.endsWith(".json"))) {
        const file = join(folder, name);
        try {
            const cache = cacheSchema.parse(
                JSON.parse(await readFile(file, "utf8"))
            );
            const collected = withoutExpired(cache.collected, now);
            if (collected !== cache.collected) {
                await writeSupplierData(
                    folder,
                    cache.bomPath,
                    { collected, manual: cache.manual ?? {} },
                    cache.bomId
                );
                changed++;
            }
        } catch {
            // Damaged or being written: left for when it's read.
        }
    }
    return changed;
}
