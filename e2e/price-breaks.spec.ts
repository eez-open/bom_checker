import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { Project } from "../src/shared/model";
import { createHistoryProject } from "../src/shared/parts-history";
import { parseProjectFile, serializeProject } from "../src/shared/project-file";
import { addRow, createProject, createRow } from "../src/shared/project-ops";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerOpenDialog,
    cell,
    clickMenuItem,
    closeApp,
    launchApp,
    setUpCredentials,
    tooltipOf
} from "./helpers";

/** A BOM with resistors that cost 0.10 each, or 0.02 from 10 on. */
function bom(reference: string, qty: number): string {
    return serializeProject(
        addRow(
            { ...createProject(), suppliers: ["digikey"] },
            createRow({
                reference,
                value: "10k",
                footprint: "R_0603",
                qty,
                partNumbers: { digikey: "FAKE-BREAKS-ND" }
            })
        )
    );
}

async function readBom(path: string): Promise<Project> {
    return parseProjectFile(await readFile(path, "utf8"));
}

async function collect(page: Page): Promise<void> {
    await page.getByRole("button", { name: "Collect…" }).click();
    const dialog = page.getByRole("dialog", { name: "Collect supplier data" });
    await dialog.getByRole("button", { name: "Start" }).click();
    await expect(
        dialog.getByRole("region", { name: "DigiKey summary" })
    ).toBeVisible();
    await dialog.getByRole("button", { name: "Close" }).click();
}

test("orders up to a price break that costs less, when confirmed (#86)", async () => {
    const folder = await mkdtemp(join(tmpdir(), "eez-breaks-"));
    const file = join(folder, "board.eezbom");
    await writeFile(file, bom("R1-R5", 5));

    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, file);
        await page.getByRole("button", { name: "Open BOM…" }).click();
        await collect(page);

        // 5 at 0.10; 10 at 0.02 would cost less.
        const orderQty = cell(page, 0, "data:digikey:orderQty");
        const total = cell(page, 0, "data:digikey:totalPrice");
        await expect(orderQty).toHaveText("5");
        await expect(total).toHaveText("0.50");
        await expect(orderQty).toHaveClass(/cell-cheaper/);
        await expect(await tooltipOf(page, orderQty)).toContainText(
            "10 pcs cost less than 5: 0.20 instead of 0.50 EUR"
        );
        await page.mouse.move(0, 0);

        await page
            .getByRole("button", { name: "1 cheaper price break" })
            .click();
        const dialog = page.getByRole("dialog", {
            name: "Cheaper price breaks"
        });
        await expect(dialog).toContainText("1 row costs less in total");
        const row = dialog.getByRole("row", { name: /R1-R5/ });
        await expect(row.getByRole("cell").nth(5)).toHaveText("5");
        await expect(row.getByRole("cell").nth(8)).toHaveText("10");
        await expect(row.getByRole("cell").nth(11)).toHaveText("0.30");
        await expect(
            dialog.getByRole("button", { name: "Apply" })
        ).toBeDisabled();
        await row.getByRole("checkbox").check();
        await expect(dialog.getByRole("status")).toHaveText(
            "1 row ordered up to a price break: 0.30 EUR less"
        );
        await dialog.getByRole("button", { name: "Apply" }).click();
        await expect(dialog).toHaveCount(0);

        await expect(orderQty).toHaveText("10");
        await expect(total).toHaveText("0.20");
        await expect(orderQty).toHaveClass(/cell-raised/);
        await expect(
            page.getByRole("button", { name: /cheaper price break/ })
        ).toHaveCount(0);
        await expect(await tooltipOf(page, orderQty)).toContainText(
            "Raised from 5 to the price break at 10"
        );
        await page.mouse.move(0, 0);

        // It's saved with the BOM, and Ctrl+Z undoes it.
        await clickMenuItem(app, "save");
        await expect
            .poll(async () => (await readBom(file)).rows[0]?.buyToBreak)
            .toBe(true);
        await page.keyboard.press("Control+Z");
        await expect(orderQty).toHaveText("5");

        // The dialog lists it again, to choose it once more.
        await clickMenuItem(app, "price-breaks");
        await expect(dialog.getByRole("checkbox")).not.toBeChecked();
        await dialog.getByRole("button", { name: "Cancel" }).click();
    } finally {
        await closeApp(app);
        await fake.close();
    }
});

test("orders rows of a Combined BOM up to a price break (#86)", async () => {
    const folder = await mkdtemp(join(tmpdir(), "eez-breaks-list-"));
    const psu = join(folder, "psu.eezbom");
    const mcu = join(folder, "mcu.eezbom");
    const list = join(folder, "device.eezbom-list");
    await writeFile(psu, bom("R1, R2", 2));
    await writeFile(mcu, bom("R7-R9", 3));
    await writeFile(
        join(folder, "device history.eezbom"),
        serializeProject(createHistoryProject())
    );
    await writeFile(
        list,
        JSON.stringify({
            schemaVersion: 1,
            boms: ["psu.eezbom", "mcu.eezbom"],
            history: "device history.eezbom"
        })
    );

    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, list);
        await page.getByRole("button", { name: "Open BOM…" }).click();
        const pane = page.getByRole("navigation", { name: "BOM list" });
        await pane.getByRole("button", { name: "Combined" }).click();
        await collect(page);

        // 2 + 3 together: 5 at 0.10, or 10 at 0.02.
        const orderQty = cell(page, 0, "data:digikey:orderQty");
        await expect(orderQty).toHaveText("5");
        await page
            .getByRole("button", { name: "1 cheaper price break" })
            .click();
        const dialog = page.getByRole("dialog", {
            name: "Cheaper price breaks"
        });
        await expect(dialog).toContainText("in the BOMs they come from");
        await dialog.getByRole("checkbox").check();
        await dialog.getByRole("button", { name: "Apply" }).click();
        await expect(orderQty).toHaveText("10");
        await expect(cell(page, 0, "data:digikey:totalPrice")).toHaveText(
            "0.20"
        );

        // The BOMs' rows have it; alone, 3 cost less as 10 too.
        await clickMenuItem(app, "save-all");
        await expect
            .poll(async () => (await readBom(psu)).rows[0]?.buyToBreak)
            .toBe(true);
        expect((await readBom(mcu)).rows[0]?.buyToBreak).toBe(true);
        await pane.getByRole("button", { name: /^mcu/ }).click();
        await expect(orderQty).toHaveText("10");
        await expect(orderQty).toHaveClass(/cell-raised/);
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
