import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { parseProjectFile, serializeProject } from "../src/shared/project-file";
import {
    addManualSupplier,
    addRow,
    createProject,
    createRow
} from "../src/shared/project-ops";
import {
    answerOpenDialog,
    cell,
    closeApp,
    fillEditor,
    fillPrices,
    launchApp,
    tooltipOf
} from "./helpers";

/** Types into a cell of a column whose id ends with `suffix`; `index`
 *  picks the supplier when there are several. */
async function typeInto(
    page: Page,
    suffix: string,
    index: number,
    text: string
) {
    const target = page
        .locator(`.ag-row[row-index="0"] .ag-cell[col-id$="${suffix}"]`)
        .nth(index);
    const columnId = (await target.getAttribute("col-id"))!;
    await target.dblclick();
    if (suffix === ":unitPrice") {
        await fillPrices(page, text);
    } else {
        await fillEditor(page, columnId, text);
    }
    await page.keyboard.press("Enter");
}

test("suppliers without an API compete for the best price", async () => {
    const { app, page } = await launchApp();
    try {
        await page.getByRole("button", { name: "New", exact: true }).click();
        await page.getByRole("button", { name: "Add row" }).click();
        await fillEditor(page, "reference", "DS1");
        await page.keyboard.press("Tab");
        await fillEditor(page, "value", "TFT 3.5in");
        await page.keyboard.press("Tab");
        await fillEditor(page, "qty", "2");
        await page.keyboard.press("Enter");

        // Two suppliers without an API.
        await page.getByRole("button", { name: "Columns…" }).click();
        const columns = page.getByRole("dialog", { name: "Columns" });
        for (const name of ["Display shop", "Enclosures"]) {
            await columns.getByLabel("New supplier name").fill(name);
            await columns.getByRole("button", { name: "Add supplier" }).click();
        }
        await columns.getByLabel("New supplier name").fill("display SHOP");
        await expect(columns.getByText("already exists")).toBeVisible();
        await columns.getByRole("button", { name: "Close" }).click();
        await expect(
            page.getByRole("columnheader", { name: "Display shop" }).first()
        ).toBeVisible();

        // Prices typed in; the cheaper total wins.
        await typeInto(page, ":partNumber", 0, "TFT-35-A");
        await typeInto(page, ":unitPrice", 0, "2.5");
        await typeInto(page, ":unitPrice", 1, "3");
        await expect(cell(page, 0, "best:supplier")).toHaveText("Display shop");
        await expect(cell(page, 0, "best:totalPrice")).toHaveText("5.00");
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 5.00 EUR"
        );
        await expect(cell(page, "t-0", "best:totalPrice")).toHaveText("5.00");

        // Only 1 in stock: the other one has the best price.
        await typeInto(page, ":stock", 0, "1");
        await expect(
            page
                .locator(
                    '.ag-row[row-index="0"] .ag-cell[col-id$=":availability"]'
                )
                .first()
        ).toHaveText("Partial: 1");
        await expect(cell(page, 0, "best:supplier")).toHaveText("Enclosures");
        await expect(cell(page, 0, "best:totalPrice")).toHaveText("6.00");

        // Hidden from the bar above the table (#5); still counts.
        const unitPrices = page.locator(
            '.ag-row[row-index="0"] .ag-cell[col-id^="manual:"][col-id$=":unitPrice"]'
        );
        const shown = page.getByRole("group", { name: "Shown columns" });
        await shown.getByLabel("Enclosures").uncheck();
        await expect(unitPrices).toHaveCount(1);
        await expect(page.getByTestId("hidden-columns")).toContainText(
            "Hidden: Enclosures"
        );
        await expect(cell(page, 0, "best:supplier")).toHaveText("Enclosures");
        await shown.getByLabel("Enclosures").check();
        await expect(unitPrices).toHaveCount(2);
        await expect(page.getByTestId("hidden-columns")).toHaveCount(0);
    } finally {
        await closeApp(app);
    }
});

test("price breaks and one-time items of suppliers without an API", async () => {
    // Capacitors and a stencil from a shop without an API.
    const folder = await mkdtemp(join(tmpdir(), "eez-bom-checker-"));
    const filePath = join(folder, "shop.eezbom");
    let project = createProject();
    for (const [reference, value, qty] of [
        ["C1, C2", "10n", 2],
        ["", "Stencil", 1]
    ] as const) {
        project = addRow(project, createRow({ reference, value, qty }));
    }
    const { project: withShop, supplier } = addManualSupplier(project, "Shop");
    withShop.rows[0]!.manual = { [supplier.id]: { unitPrice: 1.1 } };
    withShop.rows[1]!.manual = { [supplier.id]: { unitPrice: 40 } };
    await writeFile(filePath, serializeProject(withShop));
    const column = (field: string) => `manual:${supplier.id}:${field}`;

    const { app, page } = await launchApp();
    try {
        await answerOpenDialog(app, filePath);
        await page.getByRole("button", { name: "Open…" }).click();
        await expect(cell(page, 0, column("totalPrice"))).toHaveText("2.20");

        // Lower prices from 25, 100 and 300 (#51), typed in any order.
        const unitPrice = cell(page, 0, column("unitPrice"));
        await unitPrice.dblclick();
        await fillPrices(page, "1.10", [
            ["100", "0.80"],
            ["25", "1,00"],
            ["300", "0.65"]
        ]);
        await page.keyboard.press("Enter");
        await expect(unitPrice).toHaveClass(/cell-breaks/);
        await expect(unitPrice).toHaveText("1.1000");

        // A price without its quantity can't be kept.
        await unitPrice.dblclick();
        await page.getByLabel("Price break 2 quantity").fill("");
        await expect(
            page.getByRole("group", { name: "Shop unit prices" })
        ).toContainText("Enter the quantity for the price 1.");
        await page.keyboard.press("Enter");
        await expect(page.getByLabel("Price break 2 quantity")).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(page.getByLabel("Price break 2 quantity")).toHaveCount(0);

        // The stencil is needed once, however many boards (#53).
        const oneTime = cell(page, 1, column("oneTime")).locator("input");
        await oneTime.click();
        await expect(oneTime).toBeChecked();
        const build = page.getByLabel("Build qty");
        await build.fill("50");
        await build.press("Enter");
        // 100 capacitors at 0.80; one stencil.
        await expect(unitPrice).toHaveText("0.8000");
        await expect(cell(page, 0, column("totalPrice"))).toHaveText(
            "80.00 (1.60)"
        );
        await expect(cell(page, 1, column("orderQty"))).toHaveText("1");
        await expect(cell(page, 1, column("totalPrice"))).toHaveText(
            "40.00 (0.80)"
        );
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 120.00 EUR (2.40 EUR per unit)"
        );
        // The prices, one per line.
        await expect(await tooltipOf(page, unitPrice)).toHaveText(
            "1+: 1.1 EUR 25+: 1 EUR 100+: 0.8 EUR 300+: 0.65 EUR For 100 pcs: 0.8 EUR each."
        );
        await build.fill("250");
        await build.press("Enter");
        await expect(cell(page, 0, column("totalPrice"))).toHaveText(
            "325.00 (1.30)"
        );

        await page.getByRole("button", { name: "Save", exact: true }).click();
        await expect(page).toHaveTitle("shop - EEZ BOM checker");
        const saved = parseProjectFile(await readFile(filePath, "utf8"));
        expect(saved.rows.map(row => row.manual?.[supplier.id])).toEqual([
            {
                unitPrice: 1.1,
                priceBreaks: [
                    { qty: 25, unitPrice: 1 },
                    { qty: 100, unitPrice: 0.8 },
                    { qty: 300, unitPrice: 0.65 }
                ]
            },
            { unitPrice: 40, oneTime: true }
        ]);
    } finally {
        await closeApp(app);
    }
});
