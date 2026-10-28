import { mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CollectedData } from "../../shared/model";
import {
    readSupplierData,
    supplierDataFile,
    writeSupplierData
} from "./supplier-data";

const collected: CollectedData = {
    results: {
        digikey: {
            "D-1": {
                status: "notFound",
                runId: "run-1",
                fetchedAt: "2026-10-28T10:00:00Z"
            }
        }
    },
    runs: {
        digikey: {
            id: "run-1",
            startedAt: "2026-10-28T10:00:00Z",
            state: "complete"
        }
    }
};

async function folder(): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), "eez-supplier-data-")), "data");
}

describe("supplier data kept on the computer", () => {
    it("is kept per BOM", async () => {
        const data = await folder();
        await writeSupplierData(data, "/boms/psu.eezbom", collected);
        expect(await readSupplierData(data, "/boms/psu.eezbom")).toEqual(
            collected
        );
        expect(await readSupplierData(data, "/boms/mcu.eezbom")).toEqual({
            results: {},
            runs: {}
        });
    });

    it("isn't kept when there is none", async () => {
        const data = await folder();
        await writeSupplierData(data, "/boms/psu.eezbom", collected);
        await writeSupplierData(data, "/boms/psu.eezbom", {
            results: {},
            runs: {}
        });
        expect(await readdir(data)).toEqual([]);
    });

    it.runIf(process.platform === "win32")(
        "ignores the case of Windows paths",
        async () => {
            const data = await folder();
            await writeSupplierData(data, "C:\\BOMs\\psu.eezbom", collected);
            expect(
                await readSupplierData(data, "c:\\boms\\PSU.eezbom")
            ).toEqual(collected);
        }
    );

    it("throws when the file is damaged", async () => {
        const data = await folder();
        await writeSupplierData(data, "/boms/psu.eezbom", collected);
        await writeFile(supplierDataFile(data, "/boms/psu.eezbom"), "{");
        await expect(
            readSupplierData(data, "/boms/psu.eezbom")
        ).rejects.toThrow();
    });
});
