import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerOpenDialog,
    cell,
    clickMenuItem,
    closeApp,
    fillEditor,
    launchApp,
    menuItemChecked,
    setUpCredentials
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
        await expect(cell(page, R1, "best:supplier")).toHaveText(
            "None in stock"
        );
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 30.92 EUR · 1 row without a supplier that has enough stock"
        );

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
        await rows.selectOption({ label: "Best price: None in stock" });
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
        await page.getByRole("button", { name: "Show all" }).click();
        await expect(cell(page, TOTAL, "reference")).toHaveText("Total");
        await expect(cell(page, R1, "reference")).toHaveText("R1");

        // The Total row adds up each price column.
        await expect(cell(page, TOTAL, "reference")).toHaveText("Total");
        await expect(cell(page, TOTAL, "qty")).toHaveText("35");
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
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 31.72 EUR"
        );
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
        await expect(cell(page, TOTAL, "qty")).toHaveText("93");
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
        await expect(page.getByTestId("bom-summary")).toHaveText(
            "4 rows · 33.25 parts"
        );
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
        await expect(page.getByTestId("bom-summary")).toHaveText(
            "4 rows · 35 parts per unit × 30 = 1,050 parts"
        );
        await expect(page.getByTestId("bom-total")).toContainText(
            "EUR per unit)"
        );
        await page.keyboard.press("Control+Z");
        await expect(buildQty).toHaveValue("1");
        await expect(cell(page, D1, "data:tme:totalPrice")).toHaveText("0.62");
        await expect(cell(page, D1, "totalQty")).toHaveCount(0);
        await expect(cell(page, D1, "data:tme:orderQty")).toHaveText("50");

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
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
