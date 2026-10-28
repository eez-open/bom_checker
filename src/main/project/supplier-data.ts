import { createHash } from "node:crypto";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { z } from "zod";
import type { CollectedData } from "../../shared/model";
import { collectedSchema, hasCollectedData } from "../../shared/project-file";
import { isFileNotFound, writeFileAtomic } from "../files";

// The supplier data collected for a BOM (stock, prices, descriptions…) is
// kept on this computer, not in the BOM file: the suppliers' API terms
// don't allow passing it on, and BOM files are often published, e.g. on
// GitHub. Each BOM has its own file in the folder, named by a hash of the
// BOM's path, so a BOM that is moved or renamed outside the app is
// collected again. There is no shared parts database (DigiKey's terms
// forbid one).

export const SUPPLIER_DATA_FOLDER = "supplier-data";

const SCHEMA_VERSION = 1;

const cacheSchema = z.object({
    schemaVersion: z.literal(SCHEMA_VERSION),
    bomPath: z.string(),
    collected: collectedSchema
});

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

/** The supplier data kept for the BOM at `bomPath`; none if there is
 *  none. Throws if it can't be read or is damaged. */
export async function readSupplierData(
    folder: string,
    bomPath: string
): Promise<CollectedData> {
    let text: string;
    try {
        text = await readFile(supplierDataFile(folder, bomPath), "utf8");
    } catch (error) {
        if (isFileNotFound(error)) {
            return { results: {}, runs: {} };
        }
        throw error;
    }
    const cache = cacheSchema.parse(JSON.parse(text));
    return normalized(cache.bomPath) === normalized(bomPath)
        ? cache.collected
        : { results: {}, runs: {} };
}

/** Keeps `collected` as the supplier data of the BOM at `bomPath`. */
export async function writeSupplierData(
    folder: string,
    bomPath: string,
    collected: CollectedData
): Promise<void> {
    const file = supplierDataFile(folder, bomPath);
    if (!hasCollectedData(collected)) {
        await rm(file, { force: true });
        return;
    }
    await mkdir(folder, { recursive: true });
    await writeFileAtomic(
        file,
        JSON.stringify({
            schemaVersion: SCHEMA_VERSION,
            bomPath: resolve(bomPath),
            collected
        }) + "\n"
    );
}
