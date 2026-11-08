import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import {
    SUPPLIER_DATA_FOLDER,
    writeSupplierData
} from "../src/main/project/supplier-data";
import { parseBomListFile } from "../src/shared/bom-list-file";
import type { CollectedData, Project } from "../src/shared/model";
import { parseProjectFile, serializeProject } from "../src/shared/project-file";
import {
    addManualSupplier,
    addRow,
    createProject,
    createRow
} from "../src/shared/project-ops";
import {
    answerMessageBox,
    answerOpenDialog,
    answerSaveDialog,
    cell,
    clickMenuItem,
    closeApp,
    editor,
    fillEditor,
    launchApp
} from "./helpers";

/** Rows of [reference, value, qty, DigiKey part number]. */
function bom(rows: [string, string, number, string][]): Project {
    return rows.reduce(
        (project, [reference, value, qty, digikey]) =>
            addRow(
                project,
                createRow({
                    reference,
                    value,
                    qty,
                    footprint: "R_0603",
                    partNumbers: digikey ? { digikey } : {}
                })
            ),
        { ...createProject(), suppliers: ["digikey"] } as Project
    );
}

/** A result for D-1 fetched at `fetchedAt`. */
function d1(fetchedAt: string): CollectedData {
    return {
        results: {
            digikey: { "D-1": { status: "notFound", runId: "r", fetchedAt } }
        },
        runs: {}
    };
}

async function readBom(path: string): Promise<Project> {
    return parseProjectFile(await readFile(path, "utf8"));
}

test("keeps BOMs in a list, with a history and a Combined BOM", async () => {
    const folder = await mkdtemp(join(tmpdir(), "eez-bom-list-"));
    const psu = join(folder, "psu.eezbom");
    const mcu = join(folder, "mcu.eezbom");
    // C1 has a price from a shop without an API (#48).
    const shop = addManualSupplier(
        bom([
            ["R1, R2", "10k", 2, "D-1"],
            ["C1", "100n", 1, ""]
        ]),
        "Shop"
    );
    await writeFile(psu, serializeProject(shop.project));
    await writeFile(
        mcu,
        serializeProject(
            bom([
                ["R1", "10k", 1, "D-1"],
                ["R5", "10k", 3, "D-2"]
            ])
        )
    );
    // Both BOMs were collected before, psu later.
    const userData = await mkdtemp(join(tmpdir(), "eez-bom-list-profile-"));
    const supplierData = join(userData, SUPPLIER_DATA_FOLDER);
    await writeSupplierData(supplierData, psu, {
        collected: d1("2026-10-02T10:00:00Z"),
        // C1's price at the shop is kept there too, not in the file (#68).
        manual: {
            [shop.project.rows[1]!.id]: {
                [shop.supplier.id]: { unitPrice: 0.5 }
            }
        }
    });
    await writeSupplierData(supplierData, mcu, {
        collected: d1("2026-10-01T10:00:00Z"),
        manual: {}
    });
    const { app, page } = await launchApp({ userData });
    try {
        // A new list gets a history BOM next to it.
        await answerSaveDialog(app, join(folder, "device.eezbom-list"));
        await page.getByRole("button", { name: "BOM list" }).click();
        const pane = page.getByRole("navigation", { name: "BOM list" });
        await expect(
            pane.getByRole("heading", { name: "device" })
        ).toBeVisible();
        await expect(
            pane.getByRole("button", { name: "device history" })
        ).toBeVisible();

        await answerOpenDialog(app, [psu, mcu]);
        await pane.getByRole("button", { name: "Add BOMs…" }).click();
        const psuItem = pane.getByRole("button", { name: /^psu/ });
        const mcuItem = pane.getByRole("button", { name: /^mcu/ });
        await expect(psuItem).toHaveAttribute("aria-current", "true");
        await expect(cell(page, 0, "reference")).toHaveText("R1, R2");
        await expect(page).toHaveTitle("device · psu - EEZ BOM checker");

        // The list names the BOMs relative to its folder.
        const listFile = async () =>
            parseBomListFile(
                await readFile(join(folder, "device.eezbom-list"), "utf8")
            );
        expect(await listFile()).toEqual({
            schemaVersion: 3,
            boms: [
                { path: "psu.eezbom", perDevice: 1 },
                { path: "mcu.eezbom", perDevice: 1 }
            ],
            history: "device history.eezbom",
            buildQuantity: 1,
            description: ""
        });
        // A description of the list (#72), saved as it's typed.
        const description = pane.getByRole("textbox", { name: "Description" });
        await description.fill("Rev. B\nOrder with the enclosure.");
        await expect
            .poll(async () => (await listFile()).description)
            .toBe("Rev. B\nOrder with the enclosure.");
        // The history has each component and part number once.
        const history = await readBom(join(folder, "device history.eezbom"));
        expect(
            history.rows.map(row => [row.value, row.partNumbers.digikey])
        ).toEqual([
            ["10k", "D-1"],
            ["10k", "D-2"]
        ]);

        // Another BOM keeps unsaved changes and undo while it's not shown.
        await cell(page, 1, "value").dblclick();
        await fillEditor(page, "value", "220n");
        await page.keyboard.press("Enter");
        await mcuItem.click();
        await expect(cell(page, 1, "reference")).toHaveText("R5");
        await expect(psuItem.getByLabel("unsaved")).toBeVisible();
        await psuItem.click();
        await expect(cell(page, 1, "value")).toHaveText("220n");
        await page.keyboard.press("Control+Z");
        await expect(cell(page, 1, "value")).toHaveText("100n");
        await page.keyboard.press("Control+Y");
        await expect(cell(page, 1, "value")).toHaveText("220n");

        // The search stays when another BOM of the list is shown (#60).
        const search = page.getByLabel("Search the table");
        await search.fill("R5");
        await expect(page.getByTestId("shown-rows")).toContainText(
            "Showing 0 of 2 rows"
        );
        await mcuItem.click();
        await expect(search).toHaveValue("R5");
        await expect(page.getByTestId("shown-rows")).toContainText(
            "Showing 1 of 2 rows"
        );
        await expect(cell(page, 0, "reference")).toHaveText("R5");
        await search.fill("");
        await psuItem.click();
        await expect(page.getByTestId("shown-rows")).toHaveCount(0);

        // Combined: the same part numbers in one row, with the BOMs.
        await pane.getByRole("button", { name: "Combined" }).click();
        // Showing it changes no BOM, although psu has newer data for D-1.
        await expect(mcuItem.getByLabel("unsaved")).toHaveCount(0);
        await expect(cell(page, 0, "reference")).toHaveText(
            "R1, R2 (psu); R1 (mcu)"
        );
        await expect(cell(page, 0, "qty")).toHaveText("3");
        // Two mcu boards per device, and 10 devices (#39); the list keeps
        // both.
        const perDevice = pane.getByLabel("mcu per device");
        await perDevice.fill("2");
        await perDevice.press("Enter");
        await expect(cell(page, 0, "qty")).toHaveText("4");
        const devices = page.getByLabel("Build qty");
        await devices.fill("10");
        await devices.press("Enter");
        await expect(cell(page, 0, "totalQty")).toHaveText("40");
        await expect
            .poll(async () => (await listFile()).buildQuantity)
            .toBe(10);
        expect((await listFile()).boms[1]).toEqual({
            path: "mcu.eezbom",
            perDevice: 2
        });
        await expect(
            page
                .locator('.ag-row[row-index="0"] .ag-cell[col-id^="custom:"]')
                .first()
        ).toHaveText("psu, mcu");
        await expect(cell(page, 2, "reference")).toHaveText("R5");
        // With the BOMs' suppliers without an API and their prices (#48).
        await expect(cell(page, 1, "best:supplier")).toHaveText("Shop");
        // 10 devices, and the price of one.
        await expect(cell(page, 1, "best:totalPrice")).toHaveText(
            "5.00 (0.50)"
        );
        // What each BOM costs (#54): only psu has a price; D-1 wasn't
        // found.
        await pane.getByRole("button", { name: "Cost by BOM…" }).click();
        const costs = page.getByRole("dialog", { name: "Cost by BOM" });
        await expect(costs.getByTestId("cost-summary")).toHaveText(
            "Combined BOM's best price total: 5.00 EUR for 10 devices, from 1 BOM with a price."
        );
        await expect(costs.locator("tbody tr")).toHaveText([
            /^1psu× 15\.00100\.0%$/
        ]);
        await expect(costs.getByTestId("cost-warning")).toBeVisible();
        await page.keyboard.press("Escape");
        await clickMenuItem(app, "bom-costs");
        await expect(costs).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(costs).toHaveCount(0);
        // It can't be edited.
        await cell(page, 1, "value").dblclick();
        await expect(editor(page, "value")).toHaveCount(0);
        // Its cells can be copied (#63): with the button shown on hover,
        // or Ctrl+C on the focused cell.
        const clipboard = () =>
            app.evaluate(({ clipboard }) => clipboard.readText());
        const value = cell(page, 0, "value");
        await value.hover();
        await value.getByRole("button", { name: "Copy 10k" }).click();
        await expect(page.locator("footer [role=status]")).toHaveText(
            "Copied “10k”"
        );
        expect(await clipboard()).toBe("10k");
        await cell(page, 0, "pn:digikey").click();
        await page.keyboard.press("Control+C");
        await expect.poll(clipboard).toBe("D-1");
        await expect(
            page.getByRole("button", { name: "Save", exact: true })
        ).toHaveCount(0);

        // Save All writes the changed BOM.
        await clickMenuItem(app, "save-all");
        await expect(psuItem.getByLabel("unsaved")).toHaveCount(0);
        expect((await readBom(psu)).rows[1]?.value).toBe("220n");

        // Forgetting data in Combined forgets it in the BOMs too (#40).
        const d1Badge = cell(page, 0, "pn:digikey").locator(".pn-badge");
        await expect(d1Badge).toHaveAttribute("aria-label", "Not found");
        await page
            .locator('.ag-row[row-index="0"] .ag-selection-checkbox input')
            .first()
            .check();
        await answerMessageBox(app, 0);
        await page.getByRole("button", { name: "Forget data…" }).click();
        await expect(d1Badge).toHaveCount(0);
        await expect(psuItem.getByLabel("unsaved")).toBeVisible();
        await expect(mcuItem.getByLabel("unsaved")).toBeVisible();

        // Removed from the list, the file stays.
        await mcuItem.click();
        await pane.getByRole("button", { name: "Remove" }).click();
        await expect(mcuItem).toHaveCount(0);
        // The list is saved right after it shows the change.
        await expect
            .poll(async () => (await listFile()).boms)
            .toEqual([{ path: "psu.eezbom", perDevice: 1 }]);
        expect((await readBom(mcu)).rows).toHaveLength(2);
    } finally {
        await closeApp(app);
    }
});
