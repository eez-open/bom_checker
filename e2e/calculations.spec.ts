import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { startFakeSuppliers } from "./fake-suppliers";
import {
    answerOpenDialog,
    cell,
    closeApp,
    fillEditor,
    launchApp,
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
        await expect(cell(page, R1, "data:digikey:availability")).toHaveText(
            "Choose an item"
        );
        await expect(cell(page, R1, "best:supplier")).toHaveText(
            "None in stock"
        );
        await expect(page.getByTestId("bom-total")).toHaveText(
            "Best price total: 30.92 EUR · 1 row without a supplier that has enough stock"
        );

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
    } finally {
        await closeApp(app);
        await fake.close();
    }
});
