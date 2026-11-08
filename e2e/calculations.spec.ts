import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerOpenDialog,
    answerSaveDialog,
    cell,
    clickMenuItem,
    closeApp,
    fillEditor,
    launchApp,
    menuItemChecked,
    setUpCredentials,
    tooltipOf
} from "./helpers";

const BOM = join(__dirname, "fixtures/calc-bom.csv");
// Rows of calc-bom.csv, in order.
const D1 = 0;
const U1 = 1;
const R1 = 2;
const C1 = 3;
const TOTAL = "t-0";

test("calculates order quantities, prices and the best supplier", async () => {
    const fake = await startFakeSuppliers();
    const { app, page } = await launchApp({
        env: { EEZ_BOM_CHECKER_API_URLS: JSON.stringify(fake.urls) }
    });
    try {
        await setUpCredentials(page);
        await answerOpenDialog(app, BOM);
        await page.getByRole("button", { name: "Import CSV…" }).click();
        await page.getByRole("button", { name: "Import", exact: true }).click();

        await page.getByRole("button", { name: "Collect…" }).click();
        const collect = page.getByRole("dialog", {
            name: "Collect supplier data"
        });
        await collect.getByRole("button", { name: "Start" }).click();
        for (const supplier of ["DigiKey", "Mouser", "TME"]) {
            await expect(
                collect.getByRole("region", { name: `${supplier} summary` })
            ).toBeVisible();
        }
        await collect.getByRole("button", { name: "Close" }).click();

        // TME: Qty 2, MOQ 50 in multiples of 50 → order 50 at 0.0124.
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("50");
        await expect(cell(page, D1, "data:tme:unitPrice")).toHaveText("0.0124");
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveText("0.62");
        await expect(cell(page, D1, "data:tme:availability")).toHaveText(
            "In stock"
        );
        await expect(cell(page, U1, "data:mouser:totalPrice")).toHaveText(
            "6.30"
        );

        // The scope's example: Mouser is cheaper but has only 10 of 20.
        await expect(cell(page, C1, "data:mouser:availability")).toHaveText(
            "Partial: 10"
        );
        await expect(cell(page, C1, "data:digikey:availability")).toHaveText(
            "In stock"
        );
        await expect(cell(page, C1, "best:supplier")).toHaveText("DigiKey");
        await expect(cell(page, C1, "best:totalPrice")).toHaveText("24.00");
        await expect(cell(page, C1, "data:digikey:status")).toHaveText("NRND");
        await expect(cell(page, C1, "data:digikey:status")).toHaveClass(
            /lifecycle-warning/
        );

        // A manufacturer number that matches two DigiKey packagings.
        await expect(
            cell(page, R1, "data:digikey:availability").getByRole("combobox", {
                name: "Choose the DigiKey item for RMCF0805FT100K"
            })
        ).toBeVisible();
        // Both are in stock, so not "None in stock" (#74).
        await expect(cell(page, R1, "best:supplier")).toHaveText(
            "No best price"
        );
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 30.92 EUR · 1 row that no supplier can deliver"
        );
        // The Best price header and the chart warn of it (#49).
        const leftOut =
            "1 row has no supplier that can deliver any of it, so the best price leaves it out.";
        const bestHeader = page.locator(".group-header", {
            hasText: "Best price"
        });
        await expect(bestHeader).toHaveClass(/group-header-warning/);
        await expect(bestHeader).toHaveAttribute("title", leftOut);
        await page.getByRole("button", { name: "Top 10" }).click();
        const costChart = page.getByRole("dialog", {
            name: "Most expensive parts"
        });
        await expect(costChart.getByTestId("cost-warning")).toHaveText(leftOut);
        await page.keyboard.press("Escape");
        await expect(costChart).toHaveCount(0);

        // Search (Ctrl+F, #29): rows with the text in any column.
        await clickMenuItem(app, "find");
        const search = page.getByLabel("Search the table");
        await expect(search).toBeFocused();
        await page.keyboard.type("tps54");
        await expect(page.getByTestId("shown-rows")).toContainText(
            "Showing 1 of 4 rows"
        );
        await expect(cell(page, 0, "reference")).toHaveText("U1");
        await expect(cell(page, 0, "row")).toHaveText("2");
        await search.press("Escape");
        await expect(page.getByTestId("shown-rows")).toHaveCount(0);

        // Rows by best supplier (#25); the Total row adds up those shown.
        const rows = page.getByLabel("Rows");
        await rows.selectOption({ label: "Best price: None" });
        await expect(cell(page, 0, "reference")).toHaveText("R1");
        await expect(page.getByTestId("shown-rows")).toContainText(
            "Showing 1 of 4 rows"
        );
        await rows.selectOption({ label: "Best price: DigiKey" });
        await expect(cell(page, 0, "reference")).toHaveText("C1");
        await expect(cell(page, TOTAL, "reference")).toHaveText(
            "Total of shown rows"
        );
        await expect(cell(page, TOTAL, "best:totalPrice")).toHaveText("24.00");
        // Like the Total row, the warning is about the shown rows.
        await expect(bestHeader).not.toHaveClass(/group-header-warning/);
        await page.getByRole("button", { name: "Show all" }).click();
        await expect(cell(page, TOTAL, "reference")).toHaveText("Total");
        await expect(cell(page, R1, "reference")).toHaveText("R1");
        await expect(bestHeader).toHaveClass(/group-header-warning/);

        // The Total row adds up each price column, but not the quantities
        // of different parts (#42).
        await expect(cell(page, TOTAL, "reference")).toHaveText("Total");
        await expect(cell(page, TOTAL, "qty")).toHaveText("");
        await expect(cell(page, TOTAL, "data:tme:totalPrice")).toHaveText(
            "0.62"
        );
        await expect(cell(page, TOTAL, "data:digikey:totalPrice")).toHaveText(
            "24.00"
        );
        await expect(cell(page, TOTAL, "best:totalPrice")).toHaveText("30.92");

        await cell(page, R1, "pn:digikey")
            .getByRole("button", { name: "Choose the item" })
            .click();
        const choose = page.getByRole("dialog", {
            name: "Choose the DigiKey item"
        });
        await choose
            .getByRole("row", { name: /RMCF0805FT100KCT-ND/ })
            .getByRole("button", { name: "Choose" })
            .click();
        await expect(choose).toBeHidden();
        await expect(cell(page, R1, "pn:digikey")).toHaveText(
            /RMCF0805FT100KCT-ND/
        );
        await expect(cell(page, R1, "best:totalPrice")).toHaveText("0.80");
        // Stock of the product's other packaging, in the tooltip.
        const tooltip = await tooltipOf(
            page,
            cell(page, R1, "data:digikey:availability")
        );
        await expect(tooltip).toHaveText(
            "Other packaging: RMCF0805FT100KTR-ND (Tape & Reel (TR)): 500000 in stock, MOQ 5000."
        );
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 31.72 EUR"
        );
        await expect(bestHeader).not.toHaveClass(/group-header-warning/);
        await expect(cell(page, TOTAL, "data:digikey:totalPrice")).toHaveText(
            "24.80"
        );
        await expect(cell(page, TOTAL, "best:totalPrice")).toHaveText("31.72");

        // Changing Qty recalculates at once; undo brings it back.
        await cell(page, D1, "qty").dblclick();
        await fillEditor(page, "qty", "60");
        await page.keyboard.press("Enter");
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("100");
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveText("1.24");
        await expect(cell(page, TOTAL, "data:tme:totalPrice")).toHaveText(
            "1.24"
        );
        await page.keyboard.press("Control+Z");
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("50");

        // A decimal Qty (#19), e.g. part of a roll: still one package of 50.
        await cell(page, D1, "qty").dblclick();
        await fillEditor(page, "qty", "0.25");
        await page.keyboard.press("Enter");
        await expect(cell(page, D1, "qty")).toHaveText("0.25");
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("50");
        await page.keyboard.press("Control+Z");
        await expect(cell(page, D1, "qty")).toHaveText("2");

        // Build quantity: every Qty × 30, undone with Ctrl+Z.
        const buildQty = page.getByLabel("Build qty");
        await buildQty.fill("30");
        await buildQty.press("Enter");
        await expect(cell(page, D1, "totalQty")).toHaveText("60");
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("100");
        // Totals show the price per unit too (#27): 1.24 / 30.
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveText(
            "1.24 (0.04)"
        );
        await expect(cell(page, TOTAL, "totalQty")).toHaveText("");
        await expect(page.getByTestId("bom-total")).toContainText(
            "EUR per unit)"
        );
        await page.keyboard.press("Control+Z");
        await expect(buildQty).toHaveValue("1");
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveText("0.62");
        await expect(cell(page, D1, "totalQty")).toHaveCount(0);
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("50");

        // Not enough stock anywhere (#74): C1 needs 1200 for 60 units, and
        // DigiKey has the most, 1000, so the best price is for those.
        await buildQty.fill("60");
        await buildQty.press("Enter");
        await expect(cell(page, C1, "data:digikey:availability")).toHaveText(
            "Partial: 1,000"
        );
        const partialBest = cell(page, C1, "best:supplier");
        await expect(partialBest).toHaveText("DigiKey (Partial: 1,000)");
        await expect(partialBest).toHaveClass(/avail-warning/);
        await expect(cell(page, C1, "best:orderQty")).toHaveText("1,000");
        await expect(cell(page, C1, "best:totalPrice")).toHaveText(
            "1,200.00 (20.00)"
        );
        const partly =
            "1 row has no supplier with enough stock, so its best price is for the part in stock.";
        await expect(bestHeader).toHaveClass(/group-header-warning/);
        await expect(bestHeader).toHaveAttribute("title", partly);
        await expect(page.getByTestId("bom-total")).toContainText(
            "· 1 row only partly in stock"
        );
        await rows.selectOption({ label: "Best price: Partial" });
        await expect(page.getByTestId("shown-rows")).toContainText(
            "Showing 1 of 4 rows"
        );
        await expect(cell(page, 0, "reference")).toHaveText("C1");
        await page.getByRole("button", { name: "Top 10" }).click();
        await expect(costChart.getByTestId("cost-warning")).toHaveText(partly);
        await page.keyboard.press("Escape");
        await page.getByRole("button", { name: "Show all" }).click();
        await page.keyboard.press("Control+Z");
        await expect(buildQty).toHaveValue("1");
        await expect(partialBest).toHaveText("DigiKey");
        await expect(bestHeader).not.toHaveClass(/group-header-warning/);

        // View menu: hide all of TME's columns, then show them again.
        await clickMenuItem(app, "columns:tme");
        await expect(cell(page, D1, "pn:tme")).toHaveCount(0);
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveCount(0);
        await expect(cell(page, D1, "pn:mouser")).toHaveCount(1);
        await expect(page.getByTestId("hidden-columns")).toContainText(
            "Hidden: TME"
        );
        await expect
            .poll(() => menuItemChecked(app, "columns:tme"))
            .toBe(false);
        await page
            .getByTestId("hidden-columns")
            .getByRole("button", { name: "Show all" })
            .click();
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveText("0.62");
        await expect(page.getByTestId("hidden-columns")).toHaveCount(0);
        await expect.poll(() => menuItemChecked(app, "columns:tme")).toBe(true);

        // The same from the bar above the table (#5).
        const shown = page.getByRole("group", { name: "Shown columns" });
        await shown.getByLabel("Best price").uncheck();
        await expect(cell(page, D1, "best:supplier")).toHaveCount(0);
        await expect
            .poll(() => menuItemChecked(app, "columns:best"))
            .toBe(false);
        await clickMenuItem(app, "columns:best");
        await expect(shown.getByLabel("Best price")).toBeChecked();
        await expect(cell(page, D1, "best:supplier")).toHaveCount(1);

        // Each supplier, and Best price, on a tab of its own (#41).
        await page.getByLabel("Tabs", { exact: true }).check();
        const tabs = page.getByRole("tablist", { name: "Suppliers" });
        await expect(tabs.getByRole("tab")).toHaveText([
            "DigiKey",
            "Mouser",
            "TME",
            "Best price"
        ]);
        await expect(
            tabs.getByRole("tab", { name: "DigiKey" })
        ).toHaveAttribute("aria-selected", "true");
        await expect(cell(page, D1, "pn:digikey")).toHaveCount(1);
        await expect(cell(page, D1, "pn:mouser")).toHaveCount(0);
        await expect(cell(page, D1, "best:supplier")).toHaveCount(0);
        await expect(cell(page, D1, "qty")).toHaveCount(1);
        await expect(shown).toHaveCount(0);
        await tabs.getByRole("tab", { name: "Best price" }).click();
        await expect(cell(page, D1, "best:supplier")).toHaveText("TME");
        await expect(cell(page, D1, "pn:digikey")).toHaveCount(0);
        // Ctrl+2 (View → Mouser Columns) shows the Mouser tab.
        await clickMenuItem(app, "columns:mouser");
        await expect(cell(page, D1, "pn:mouser")).toHaveCount(1);
        await expect(cell(page, D1, "best:supplier")).toHaveCount(0);
        await expect
            .poll(() => menuItemChecked(app, "columns:mouser"))
            .toBe(true);
        await clickMenuItem(app, "tabs");
        await expect(tabs).toHaveCount(0);
        await expect(cell(page, D1, "pn:digikey")).toHaveCount(1);
        await expect(cell(page, D1, "best:supplier")).toHaveCount(1);

        // The most expensive parts (#28), from the status bar and the menu.
        await page
            .getByRole("button", { name: "Most expensive parts" })
            .click();
        const chart = page.getByRole("dialog", {
            name: "Most expensive parts"
        });
        await expect(chart.getByTestId("cost-summary")).toHaveText(
            "Best price total: 31.72 EUR, from 4 rows with a price."
        );
        await expect(chart.getByTestId("cost-warning")).toHaveCount(0);
        await expect(chart.locator("tbody tr")).toHaveText([
            /^1C1100nDigiKey24\.0075\.7%$/,
            /^2U1TPS54331Mouser6\.3019\.9%$/,
            /^3R1100kDigiKey0\.802\.5%$/,
            /^4D11N4007TME0\.622\.0%$/
        ]);
        await expect(
            chart.getByRole("img", { name: /most expensive rows/ })
        ).toBeVisible();
        // A colour per rank.
        const fills = await Promise.all(
            (await chart.locator("path.cost-slice").all()).map(path =>
                path.getAttribute("fill")
            )
        );
        expect(new Set(fills).size).toBe(4);

        // Copied, or saved as PNG.
        await chart.getByRole("button", { name: "Copy picture" }).click();
        await expect(chart.getByRole("status")).toHaveText(
            "The chart was copied."
        );
        expect(
            await app.evaluate(({ clipboard }) => clipboard.has("image/png"))
        ).toBe(true);
        const picture = join(
            await mkdtemp(join(tmpdir(), "eez-chart-")),
            "chart.png"
        );
        await answerSaveDialog(app, picture);
        await chart.getByRole("button", { name: "Save as PNG…" }).click();
        await expect(chart.getByRole("status")).toHaveText(
            "Saved as chart.png."
        );
        // The PNG signature.
        expect([...(await readFile(picture)).subarray(0, 4)]).toEqual([
            0x89, 0x50, 0x4e, 0x47
        ]);
        await chart.getByRole("button", { name: "Close" }).click();

        // Also from the menu and the Best price header.
        await clickMenuItem(app, "cost-chart");
        await expect(chart).toBeVisible();
        await page.keyboard.press("Escape");
        await expect(chart).toHaveCount(0);
        await page.getByRole("button", { name: "Top 10" }).click();
        await expect(chart).toBeVisible();
        await page.keyboard.press("Escape");
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
