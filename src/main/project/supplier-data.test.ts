import { mkdir, mkdtemp, readdir, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { CollectedData } from "../../shared/model";
import {
    findSupplierData,
    noSupplierData,
    readSupplierData,
    supplierDataFile,
    writeSupplierData,
    type SupplierData
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

const data: SupplierData = {
    collected,
    manual: { "row-1": { shop: { unitPrice: 2.5, moq: 10 } } }
};

async function folder(): Promise<string> {
    return join(await mkdtemp(join(tmpdir(), "eez-supplier-data-")), "data");
}

describe("supplier data kept on the computer", () => {
    it("is kept per BOM, with the prices of suppliers without an API", async () => {
        const store = await folder();
        await writeSupplierData(store, "/boms/psu.eezbom", data, "bom-1");
        expect(await readSupplierData(store, "/boms/psu.eezbom")).toEqual(data);
        expect(await readSupplierData(store, "/boms/mcu.eezbom")).toEqual(
            noSupplierData()
        );
    });

    it("isn't kept when there is none", async () => {
        const store = await folder();
        await writeSupplierData(store, "/boms/psu.eezbom", data);
        await writeSupplierData(store, "/boms/psu.eezbom", noSupplierData());
        expect(await readdir(store)).toEqual([]);
        // Prices alone are kept.
        await writeSupplierData(store, "/boms/psu.eezbom", {
            ...noSupplierData(),
            manual: data.manual
        });
        expect(
            (await readSupplierData(store, "/boms/psu.eezbom")).manual
        ).toEqual(data.manual);
    });

    it("reads files of version 1, with collected data only", async () => {
        const store = await folder();
        await mkdir(store, { recursive: true });
        await writeFile(
            supplierDataFile(store, "/boms/psu.eezbom"),
            JSON.stringify({
                schemaVersion: 1,
                bomPath: join("/boms/psu.eezbom"),
                collected
            })
        );
        expect(await readSupplierData(store, "/boms/psu.eezbom")).toEqual({
            collected,
            manual: {}
        });
    });

    it("finds a moved BOM's data by its id, the newest of copies (#68)", async () => {
        const store = await folder();
        await writeSupplierData(store, "/boms/old.eezbom", data, "bom-1");
        const copy = { ...data, manual: {} };
        await writeSupplierData(store, "/boms/copy.eezbom", copy, "bom-1");
        await writeSupplierData(store, "/boms/other.eezbom", data, "bom-2");
        // The copy is older.
        const past = new Date("2026-01-01T00:00:00Z");
        await utimes(supplierDataFile(store, "/boms/copy.eezbom"), past, past);
        expect(await findSupplierData(store, "bom-1")).toEqual(data);
        expect(await findSupplierData(store, "bom-3")).toBeNull();
        expect(await findSupplierData(join(store, "none"), "bom-1")).toBeNull();
    });

    it.runIf(process.platform === "win32")(
        "ignores the case of Windows paths",
        async () => {
            const store = await folder();
            await writeSupplierData(store, "C:\\BOMs\\psu.eezbom", data);
            expect(
                await readSupplierData(store, "c:\\boms\\PSU.eezbom")
            ).toEqual(data);
        }
    );

    it("throws when the file is damaged", async () => {
        const store = await folder();
        await writeSupplierData(store, "/boms/psu.eezbom", data);
        await writeFile(supplierDataFile(store, "/boms/psu.eezbom"), "{");
        await expect(
            readSupplierData(store, "/boms/psu.eezbom")
        ).rejects.toThrow();
    });
});
