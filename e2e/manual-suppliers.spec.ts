import { expect, test, type Page } from "@playwright/test";
import { cell, closeApp, fillEditor, launchApp } from "./helpers";

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
    await fillEditor(page, columnId, text);
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
    } finally {
        await closeApp(app);
    }
});
