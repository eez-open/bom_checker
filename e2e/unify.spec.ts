import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { serializeBomList } from "../src/shared/bom-list-file";
import type { Project } from "../src/shared/model";
import { createHistoryProject } from "../src/shared/parts-history";
import { parseProjectFile, serializeProject } from "../src/shared/project-file";
import { addRow, createProject, createRow } from "../src/shared/project-ops";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerMessageBox,
    answerOpenDialog,
    closeApp,
    launchApp,
    setUpCredentials
} from "./helpers";

function bom(reference: string, qty: number, digikey: string): string {
    const project = addRow(
        { ...createProject(), suppliers: ["digikey"] },
        createRow({
            reference,
            value: "100k",
            footprint: "R_0805",
            qty,
            partNumbers: { digikey }
        })
    );
    return serializeProject(project);
}

async function readBom(path: string): Promise<Project> {
    return parseProjectFile(await readFile(path, "utf8"));
}

/** psu and mcu, with the same resistor under different part numbers, in
 *  a list with an empty history. */
async function writeList() {
    const folder = await mkdtemp(join(tmpdir(), "eez-unify-"));
    const files = {
        folder,
        psu: join(folder, "psu.eezbom"),
        mcu: join(folder, "mcu.eezbom"),
        history: join(folder, "device history.eezbom"),
        list: join(folder, "device.eezbom-list")
    };
    await writeFile(files.psu, bom("R1, R2", 2, "FAKE-PLENTY-ND"));
    await writeFile(files.mcu, bom("R7", 3, "RMCF0805FT100KCT-ND"));
    await writeFile(files.history, serializeProject(createHistoryProject()));
    await writeFile(
        files.list,
        serializeBomList({
            schemaVersion: 1,
            boms: ["psu.eezbom", "mcu.eezbom"],
            history: "device history.eezbom"
        })
    );
    return files;
}

test("gives the BOMs the data collected in Combined", async () => {
    const { list } = await writeList();
    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, list);
        await page.getByRole("button", { name: "Open BOM…" }).click();
        const pane = page.getByRole("navigation", { name: "BOM list" });
        const psuItem = pane.getByRole("button", { name: /^psu/ });
        await pane.getByRole("button", { name: "Combined" }).click();
        await expect(psuItem.getByLabel("unsaved")).toHaveCount(0);

        await page.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        await collect.getByRole("button", { name: "Start" }).click();
        await expect(
            collect.getByRole("region", { name: "DigiKey summary" })
        ).toBeVisible();
        await collect.getByRole("button", { name: "Close" }).click();

        await expect(psuItem.getByLabel("unsaved")).toBeVisible();
        await psuItem.click();
        await expect(
            page.locator(
                '.ag-row[row-index="0"] .ag-cell[col-id="data:digikey:availability"]'
            )
        ).toHaveText("In stock");
    } finally {
        await closeApp(app);
        await fake.close();
    }
});

test("unifies part numbers across the BOMs of a list", async () => {
    const { folder, psu, mcu, history, list } = await writeList();

    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, list);
        await page.getByRole("button", { name: "Open BOM…" }).click();
        const pane = page.getByRole("navigation", { name: "BOM list" });
        await pane.getByRole("button", { name: "Unify part numbers…" }).click();

        const unify = page.getByRole("dialog", { name: "Unify part numbers" });
        await expect(unify).toContainText(
            "1 component has different part numbers or Values"
        );
        const group = unify.getByRole("region", { name: "100k · R_0805" });
        await expect(group).toContainText("5 pcs in 2 rows");
        await expect(group).toContainText("psu: R1, R2 · mcu: R7");
        const plenty = group.getByRole("radio", { name: "FAKE-PLENTY-ND" });
        const cutTape = group.getByRole("radio", {
            name: "RMCF0805FT100KCT-ND"
        });
        // Without data, the first of the most used is suggested.
        await expect(plenty).toBeChecked();
        await expect(group.getByText("Not collected")).toHaveCount(2);

        // Collect the part numbers offered, for 5 pieces.
        await unify.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        await collect.getByRole("button", { name: "Start" }).click();
        await expect(
            collect.getByRole("region", { name: "DigiKey summary" })
        ).toBeVisible();
        await collect.getByRole("button", { name: "Close" }).click();
        const cutTapeRow = group.getByRole("row", {
            name: /RMCF0805FT100KCT-ND/
        });
        await expect(cutTapeRow).toContainText("Best price");
        await expect(cutTapeRow.getByRole("cell").nth(6)).toHaveText("0.40");

        await unify.getByRole("button", { name: "Choose suggestions" }).click();
        await expect(cutTape).toBeChecked();
        await expect(unify).toContainText("1 row in 1 BOM will change");
        // A new Value for every row of the component.
        await group
            .getByRole("textbox", { name: "Other Value of 100k · R_0805" })
            .fill("100k 1%");
        await expect(unify).toContainText("2 rows in 2 BOMs will change");

        await answerMessageBox(app, 0); // "Apply"
        await unify.getByRole("button", { name: "Apply…" }).click();
        await expect(unify.getByRole("status")).toHaveText(
            "Changed 2 rows in 2 BOMs and saved them."
        );
        await unify.getByRole("button", { name: "Close" }).click();

        // psu has the cut tape now, with its data; a copy from before is
        // in the backup folder.
        const saved = await readBom(psu);
        expect(saved.rows[0]?.partNumbers.digikey).toBe("RMCF0805FT100KCT-ND");
        expect(saved.rows[0]?.value).toBe("100k 1%");
        expect((await readBom(mcu)).rows[0]?.value).toBe("100k 1%");
        expect(
            saved.collected.results.digikey?.["RMCF0805FT100KCT-ND"]?.status
        ).toBe("found");
        const backups = await readdir(join(folder, "bom-checker-backups"));
        expect(backups).toHaveLength(1);
        expect(
            (
                await readdir(join(folder, "bom-checker-backups", backups[0]!))
            ).sort()
        ).toEqual(["backup.json", "mcu.eezbom", "psu.eezbom"]);
        const copy = await readBom(
            join(folder, "bom-checker-backups", backups[0]!, "psu.eezbom")
        );
        expect(copy.rows[0]?.partNumbers.digikey).toBe("FAKE-PLENTY-ND");

        // The history got the part number psu uses now.
        expect(
            (await readBom(history)).rows.map(row => row.partNumbers.digikey)
        ).toEqual(["RMCF0805FT100KCT-ND"]);

        // The open BOM shows the change, and Ctrl+Z undoes it.
        const psuItem = pane.getByRole("button", { name: /^psu/ });
        await psuItem.click();
        const digikey = page.locator(
            '.ag-row[row-index="0"] .ag-cell[col-id="pn:digikey"]'
        );
        await expect(digikey).toHaveText(/RMCF0805FT100KCT-ND/);
        await expect(psuItem.getByLabel("unsaved")).toHaveCount(0);
        await page.keyboard.press("Control+Z");
        await expect(digikey).toHaveText(/FAKE-PLENTY-ND/);
        await expect(
            page.locator('.ag-row[row-index="0"] .ag-cell[col-id="value"]')
        ).toHaveText("100k");
        await expect(psuItem.getByLabel("unsaved")).toBeVisible();
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
